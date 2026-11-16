import base64
import io
import threading
import time

import numpy as np
import pytest
from PIL import Image, ImageCms

import app as service
from faces import Detections, deduplicate, find_faces

GROUP_PHOTO_FACES = 6
PHONE_PHOTO_SIZE = (4000, 3000)
# Where the four tiles of a 4000 x 3000 photo (60% of each side) end and begin.
TILE_BORDERS_X = (2400, 1600)


def analyze(client, body: bytes) -> dict:
    response = client.post("/analyze", content=body)
    assert response.status_code == 200, response.text
    return response.json()


def embedding(face: dict) -> np.ndarray:
    return np.frombuffer(base64.b64decode(face["embedding_b64"]), dtype="<f4")


def only_embedding(client, body: bytes) -> np.ndarray:
    faces = analyze(client, body)["faces"]
    assert len(faces) == 1
    return embedding(faces[0])


def decode_jpeg(encoded: str) -> Image.Image:
    image = Image.open(io.BytesIO(base64.b64decode(encoded)))
    assert image.format == "JPEG"
    return image


def encode(image: Image.Image, image_format: str, **options) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=image_format, **options)
    return buffer.getvalue()


def public(public_image, name: str) -> Image.Image:
    return Image.open(io.BytesIO(public_image(name))).convert("RGB")


def on_phone_photo(picture: Image.Image, width: int, left: int, top: int) -> np.ndarray:
    """The picture, reduced to `width`, on a plain frame the size of a phone photo."""
    reduced = picture.resize((width, round(picture.height * width / picture.width)), Image.Resampling.LANCZOS)
    frame = Image.new("RGB", PHONE_PHOTO_SIZE, (90, 90, 90))
    frame.paste(reduced, (left, top))
    return np.asarray(frame)


def face_close_up(picture: Image.Image, models, margin: float) -> Image.Image:
    """The only face of the picture, cropped to `margin` times its box and enlarged to a 12 MP portrait."""
    (face,) = find_faces(models, np.asarray(picture), tiles=False)
    center, half = (face.box[:2] + face.box[2:]) / 2, (face.box[2:] - face.box[:2]) * margin / 2
    crop = picture.crop(tuple(int(value) for value in (*(center - half), *(center + half))))
    return crop.resize((round(crop.width * 4032 / crop.height), 4032), Image.Resampling.BICUBIC)


def srgb_profile() -> bytes:
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def box_center(face: dict) -> tuple[float, float]:
    x, y, width, height = face["box"]
    return x + width / 2, y + height / 2


def test_health(client):
    assert client.get("/health").status_code == 200


def test_response_shape(client, public_image):
    source = Image.open(io.BytesIO(public_image("group.jpg")))
    result = analyze(client, public_image("group.jpg"))

    assert set(result) == {"width", "height", "faces", "preview_b64", "thumb_b64"}
    assert (result["width"], result["height"]) == source.size
    assert len(result["faces"]) == GROUP_PHOTO_FACES
    for face in result["faces"]:
        assert set(face) == {"box", "det_score", "embedding_b64"}
        x, y, width, height = face["box"]
        assert 0 <= x < x + width <= 1 and 0 <= y < y + height <= 1
        assert 0.5 <= face["det_score"] <= 1
        vector = embedding(face)
        assert vector.shape == (512,)
        assert np.linalg.norm(vector) == pytest.approx(1.0, abs=1e-5)


def test_preview_and_thumb_sizes(client, public_image):
    source = Image.open(io.BytesIO(public_image("group.jpg")))
    small = analyze(client, public_image("group.jpg"))
    large = analyze(client, encode(source.resize((4000, 2769)), "JPEG"))

    assert decode_jpeg(small["preview_b64"]).size == source.size  # never enlarged
    assert max(decode_jpeg(small["thumb_b64"]).size) == 400
    assert decode_jpeg(large["preview_b64"]).size == (2048, 1418)
    assert decode_jpeg(large["thumb_b64"]).size == (400, 277)
    assert len(large["faces"]) == GROUP_PHOTO_FACES


def test_exif_orientation_is_applied(client, public_image):
    upright = Image.open(io.BytesIO(public_image("obama.jpg"))).convert("RGB")
    sideways = upright.transpose(Image.Transpose.ROTATE_90)
    exif = Image.Exif()
    exif[0x0112] = 6  # stored rotated; viewers must turn it 90 degrees clockwise to display
    expected = analyze(client, encode(upright, "JPEG", quality=95))
    result = analyze(client, encode(sideways, "JPEG", quality=95, exif=exif))

    assert (result["width"], result["height"]) == upright.size
    assert decode_jpeg(result["preview_b64"]).size == upright.size
    assert len(result["faces"]) == 1
    assert box_center(result["faces"][0]) == pytest.approx(box_center(expected["faces"][0]), abs=0.01)
    assert float(embedding(result["faces"][0]) @ embedding(expected["faces"][0])) > 0.95


@pytest.mark.parametrize(
    "image_format,options",
    [("HEIF", {"quality": 90}), ("PNG", {}), ("WEBP", {"quality": 90})],
)
def test_other_formats_match_the_jpeg(client, public_image, image_format, options):
    source = Image.open(io.BytesIO(public_image("obama.jpg"))).convert("RGB")
    from_jpeg = only_embedding(client, public_image("obama.jpg"))
    result = analyze(client, encode(source, image_format, **options))

    assert (result["width"], result["height"]) == source.size
    assert len(result["faces"]) == 1
    assert float(embedding(result["faces"][0]) @ from_jpeg) > 0.95


def test_colour_profile_is_kept_only_from_rgb_sources(client, public_image):
    source = public(public_image, "obama.jpg")
    profile = srgb_profile()
    from_rgb = analyze(client, encode(source, "JPEG", icc_profile=profile))
    from_grey = analyze(client, encode(source.convert("L"), "JPEG", icc_profile=profile))
    from_cmyk = analyze(client, encode(source.convert("CMYK"), "JPEG", icc_profile=profile))

    for derived in ("preview_b64", "thumb_b64"):
        assert decode_jpeg(from_rgb[derived]).info["icc_profile"] == profile
        for result in (from_grey, from_cmyk):
            assert decode_jpeg(result[derived]).mode == "RGB"
            assert "icc_profile" not in decode_jpeg(result[derived]).info
    assert len(from_grey["faces"]) == len(from_cmyk["faces"]) == 1


def test_image_without_faces(client):
    gradient = np.tile(np.linspace(0, 255, 800, dtype=np.uint8), (600, 1))
    result = analyze(client, encode(Image.fromarray(gradient).convert("RGB"), "JPEG"))

    assert result["faces"] == []
    assert (result["width"], result["height"]) == (800, 600)
    assert decode_jpeg(result["thumb_b64"]).size == (400, 300)


@pytest.mark.parametrize("body", [b"", b"this is not an image", b"\xff\xd8\xff\xe0" + b"\x00" * 64])
def test_unreadable_image_is_rejected(client, body):
    response = client.post("/analyze", content=body)

    assert response.status_code == 422
    assert isinstance(response.json()["error"], str)


def corrupted_files(public_image) -> dict[str, bytes]:
    source = public(public_image, "two_people.jpg").resize((400, 240))
    return {
        "jpeg cut in half": encode(source, "JPEG")[:4000],
        "png cut in half": encode(source, "PNG")[:20000],
        "heif cut in half": encode(source, "HEIF")[:3000],
        "gif, a format the site does not take": encode(source, "GIF"),
        "tiff, a format the site does not take": encode(source, "TIFF"),
    }


@pytest.mark.parametrize(
    "case",
    [
        "jpeg cut in half",
        "png cut in half",
        "heif cut in half",
        "gif, a format the site does not take",
        "tiff, a format the site does not take",
    ],
)
def test_corrupted_or_foreign_file_is_rejected_with_a_fixed_text(client, public_image, case):
    response = client.post("/analyze", content=corrupted_files(public_image)[case])

    assert response.status_code == 422, response.text
    assert response.json() == {"error": "could not read image"}


def test_very_elongated_image_is_analyzed(client):
    result = analyze(client, encode(Image.new("RGB", (6000, 2), (90, 90, 90)), "PNG"))

    assert (result["width"], result["height"], result["faces"]) == (6000, 2, [])
    assert decode_jpeg(result["preview_b64"]).size == (2048, 1)
    assert decode_jpeg(result["thumb_b64"]).size == (400, 1)


def test_at_most_two_analyses_run_at_once(client, monkeypatch):
    running, peak, guard = [], [], threading.Lock()

    def slow_analysis(models, body, tiles):
        with guard:
            running.append(body)
            peak.append(len(running))
        time.sleep(0.2)
        with guard:
            running.remove(body)
        return {}

    monkeypatch.setattr(service, "analyze_image", slow_analysis)
    requests = [threading.Thread(target=client.post, args=("/analyze",), kwargs={"content": bytes([i])}) for i in range(6)]
    for request in requests:
        request.start()
    for request in requests:
        request.join()

    assert len(peak) == 6 and max(peak) == 2


def test_tiles_find_the_faces_too_small_for_the_full_passes(models, public_image):
    # Faces about 16 px tall in a 12 MP photo: under 8 px in the 1920 px pass, 13 px in a tile.
    photo = on_phone_photo(public(public_image, "group.jpg"), width=200, left=1900, top=1430)

    assert len(find_faces(models, photo, tiles=True)) == GROUP_PHOTO_FACES
    assert len(find_faces(models, photo, tiles=False)) < GROUP_PHOTO_FACES


def test_tiles_are_off_unless_the_environment_asks(client, public_image):
    photo = on_phone_photo(public(public_image, "group.jpg"), width=200, left=1900, top=1430)

    assert len(analyze(client, encode(Image.fromarray(photo), "PNG"))["faces"]) < GROUP_PHOTO_FACES


@pytest.mark.parametrize("border_x", TILE_BORDERS_X)
@pytest.mark.parametrize("width", [300, 1000, 2200])
def test_face_on_a_tile_border_comes_out_once(models, public_image, border_x, width):
    obama = public(public_image, "obama.jpg")
    (face,) = find_faces(models, np.asarray(obama), tiles=False)
    face_center_x = (face.box[0] + face.box[2]) / 2 * width / obama.width
    photo = on_phone_photo(obama, width, left=round(border_x - face_center_x), top=100)

    assert len(find_faces(models, photo, tiles=True)) == 1


def test_piece_of_a_face_inside_the_whole_face_is_dropped():
    whole, piece, neighbour = [100, 100, 500, 600], [220, 300, 400, 520], [520, 100, 900, 600]
    landmarks = np.zeros((3, 5, 2), dtype=np.float32)

    def kept(scores: list[float]) -> list[list[float]]:
        boxes = np.array([whole, piece, neighbour], dtype=np.float32)
        return sorted(deduplicate(Detections(boxes, np.array(scores, dtype=np.float32), landmarks)).boxes.tolist())

    assert kept([0.80, 0.85, 0.9]) == [whole, neighbour]  # close scores: the larger box is the face
    assert kept([0.55, 0.90, 0.9]) == [piece, neighbour]  # a clear score difference decides
    assert kept([0.90, 0.60, 0.9]) == [whole, neighbour]


def test_close_up_filling_the_frame_needs_the_smallest_pass(client, models, public_image):
    # The face takes ~85% of the height: about 550 px tall even in the 640 px pass, more than the detector handles.
    close_up = face_close_up(public(public_image, "obama.jpg"), models, margin=1.15)
    from_small = only_embedding(client, public_image("obama.jpg"))

    assert float(only_embedding(client, encode(close_up, "JPEG")) @ from_small) > 0.8


def test_half_cut_large_face_needs_the_middle_pass(models, public_image):
    # A face at the edge of a 12 MP frame, too large for the 1920 px pass and missed by the 320 px one.
    source = public(public_image, "two_people.jpg")
    crop = source.crop((253, 148, 872, 511))
    photo = np.asarray(crop.resize((4032, round(crop.height * 4032 / crop.width)), Image.Resampling.BICUBIC))

    assert len(find_faces(models, photo, tiles=False)) == 1


def test_portrait_larger_than_the_detection_pass_is_found(client, public_image):
    # A face filling most of a 12 MP frame is far larger than what the detector handles at 1920 px.
    source = Image.open(io.BytesIO(public_image("obama.jpg"))).convert("RGB")
    close_up = source.crop((250, 50, 750, 720)).resize((3009, 4032), Image.Resampling.BICUBIC)
    from_small = only_embedding(client, public_image("obama.jpg"))

    assert float(only_embedding(client, encode(close_up, "JPEG")) @ from_small) > 0.9


def test_same_person_scores_above_different_people(client, public_image):
    obama = only_embedding(client, public_image("obama.jpg"))
    obama_other_photo = only_embedding(client, public_image("obama2.jpg"))
    biden = only_embedding(client, public_image("biden.jpg"))
    pair = [embedding(face) for face in analyze(client, public_image("two_people.jpg"))["faces"]]
    assert len(pair) == 2

    same = [float(obama @ obama_other_photo), max(float(obama @ face) for face in pair)]
    different = [float(obama @ biden), float(obama_other_photo @ biden), float(pair[0] @ pair[1])]
    print(f"cosine same person: {same}; different people: {different}")

    assert min(same) > max(different) + 0.3
