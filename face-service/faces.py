"""Face detection (SCRFD det_10g) and recognition (ArcFace w600k_r50) on onnxruntime CPU."""

from pathlib import Path
from typing import NamedTuple

import cv2
import numpy as np
import onnxruntime as ort

# Longest side, in pixels, of each full-image detection pass. The detector misses faces taller than roughly
# 450 px at its input scale, so the smaller passes are what find portraits and close-up selfies.
DETECTION_SIDES = (1920, 640, 320)
DETECTION_SCORE_THRESHOLD = 0.5
DEDUP_IOU_THRESHOLD = 0.4
# Share of the smaller box covered by the larger one above which both are taken as the same face.
DEDUP_CONTAINMENT_THRESHOLD = 0.6
# Between two boxes of the same face, scores closer than this do not decide; the larger box does.
DEDUP_SCORE_TIE = 0.1
DETECTION_STRIDES = (8, 16, 32)
ANCHORS_PER_CELL = 2
NETWORK_STRIDE = 32

TILE_FRACTION = 0.6

EMBEDDING_INPUT_SIZE = 112
ARCFACE_TEMPLATE = np.array(
    [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]],
    dtype=np.float32,
)


class Detections(NamedTuple):
    boxes: np.ndarray  # (n, 4) as x0, y0, x1, y1 in pixels
    scores: np.ndarray  # (n,)
    landmarks: np.ndarray  # (n, 5, 2) in pixels


class Face(NamedTuple):
    box: np.ndarray  # x0, y0, x1, y1 in pixels of the analyzed image
    det_score: float
    embedding: np.ndarray  # (512,) float32, unit norm


class FaceModels(NamedTuple):
    detector: ort.InferenceSession
    recognizer: ort.InferenceSession


def load_models(models_dir: Path, threads: int) -> FaceModels:
    """Also caps the OpenCV thread pool, which is global to the process."""
    cv2.setNumThreads(threads)
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    # det_10g declares its output sizes for a 640x640 input; any other input size logs a harmless
    # shape warning per output on every run.
    options.log_severity_level = 3

    def session(name: str) -> ort.InferenceSession:
        return ort.InferenceSession(str(models_dir / name), options, providers=["CPUExecutionProvider"])

    return FaceModels(detector=session("det_10g.onnx"), recognizer=session("w600k_r50.onnx"))


def find_faces(models: FaceModels, image: np.ndarray, tiles: bool) -> list[Face]:
    """image is RGB uint8, already oriented. tiles adds a second look at quadrants, for very small faces."""
    # A set, because on small images several passes collapse into the same scale.
    scales = {reduction_scale(image, side) for side in DETECTION_SIDES}
    full_passes = [detect(models.detector, image, scale) for scale in scales]
    tile_passes = detect_in_tiles(models.detector, image) if tiles else []
    detections = deduplicate(concatenate(full_passes + tile_passes))
    return [
        Face(box=box, det_score=float(score), embedding=embed(models.recognizer, image, landmarks))
        for box, score, landmarks in zip(*detections)
    ]


def reduction_scale(image: np.ndarray, max_side: int) -> float:
    return min(1.0, max_side / max(image.shape[:2]))


def detect(detector: ort.InferenceSession, image: np.ndarray, scale: float) -> Detections:
    height, width = image.shape[:2]
    resized = image
    if scale < 1.0:
        # At least one pixel: the short side of a very elongated image would otherwise round to zero.
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        resized = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
    canvas = pad_to_multiple(resized, NETWORK_STRIDE)
    blob = cv2.dnn.blobFromImage(canvas, 1 / 128, mean=(127.5, 127.5, 127.5))
    outputs = detector.run(None, {detector.get_inputs()[0].name: blob})
    levels = len(DETECTION_STRIDES)
    per_stride = [
        decode_stride(outputs[i], outputs[i + levels], outputs[i + 2 * levels], stride, canvas.shape[:2])
        for i, stride in enumerate(DETECTION_STRIDES)
    ]
    merged = concatenate(per_stride)
    return Detections(merged.boxes / scale, merged.scores, merged.landmarks / scale)


def pad_to_multiple(image: np.ndarray, multiple: int) -> np.ndarray:
    height, width = image.shape[:2]
    bottom = -height % multiple
    right = -width % multiple
    return cv2.copyMakeBorder(image, 0, bottom, 0, right, cv2.BORDER_CONSTANT, value=(0, 0, 0))


def decode_stride(
    scores: np.ndarray, distances: np.ndarray, offsets: np.ndarray, stride: int, canvas_size: tuple[int, int]
) -> Detections:
    rows, cols = canvas_size[0] // stride, canvas_size[1] // stride
    grid = np.stack(np.mgrid[:rows, :cols][::-1], axis=-1).reshape(-1, 2) * stride
    centers = np.repeat(grid, ANCHORS_PER_CELL, axis=0).astype(np.float32)
    scores = scores.reshape(-1)
    keep = scores >= DETECTION_SCORE_THRESHOLD
    centers = centers[keep]
    distances = distances.reshape(-1, 4)[keep] * stride
    offsets = offsets.reshape(-1, 5, 2)[keep] * stride
    boxes = np.concatenate([centers - distances[:, :2], centers + distances[:, 2:]], axis=1)
    return Detections(boxes, scores[keep], centers[:, None, :] + offsets)


def detect_in_tiles(detector: ort.InferenceSession, image: np.ndarray) -> list[Detections]:
    """Second look at overlapping quadrants, where small faces keep more pixels than in the reduced full pass."""
    height, width = image.shape[:2]
    if max(height, width) <= max(DETECTION_SIDES):
        return []
    tile_width, tile_height = round(width * TILE_FRACTION), round(height * TILE_FRACTION)
    return [
        detect_in_tile(detector, image, x0, y0, tile_width, tile_height)
        for y0 in (0, height - tile_height)
        for x0 in (0, width - tile_width)
    ]


def detect_in_tile(
    detector: ort.InferenceSession, image: np.ndarray, x0: int, y0: int, tile_width: int, tile_height: int
) -> Detections:
    tile = image[y0 : y0 + tile_height, x0 : x0 + tile_width]
    found = detect(detector, tile, reduction_scale(tile, max(DETECTION_SIDES)))
    origin = np.array([x0, y0], dtype=np.float32)
    return Detections(found.boxes + np.tile(origin, 2), found.scores, found.landmarks + origin)


def concatenate(parts: list[Detections]) -> Detections:
    return Detections(*(np.concatenate(field) for field in zip(*parts)))


def deduplicate(detections: Detections) -> Detections:
    if len(detections.scores) == 0:
        return detections
    corners = detections.boxes
    rects = np.concatenate([corners[:, :2], corners[:, 2:] - corners[:, :2]], axis=1)
    keep = cv2.dnn.NMSBoxes(rects.tolist(), detections.scores.tolist(), DETECTION_SCORE_THRESHOLD, DEDUP_IOU_THRESHOLD)
    return drop_nested(select(detections, np.asarray(keep, dtype=int).reshape(-1)))


def drop_nested(detections: Detections) -> Detections:
    """Removes the boxes that lie mostly inside another one: a piece of a face seen at another scale has a low IoU."""
    boxes, scores = detections.boxes, detections.scores
    areas = np.prod(boxes[:, 2:] - boxes[:, :2], axis=1)
    overlap = np.minimum(boxes[:, None, 2:], boxes[None, :, 2:]) - np.maximum(boxes[:, None, :2], boxes[None, :, :2])
    intersection = np.prod(np.clip(overlap, 0, None), axis=2)
    same_face = intersection >= DEDUP_CONTAINMENT_THRESHOLD * np.minimum(areas[:, None], areas[None, :])
    tied = np.abs(scores[:, None] - scores[None, :]) <= DEDUP_SCORE_TIE
    # beaten[i, j]: box i loses to box j.
    beaten = np.where(tied, areas[:, None] < areas[None, :], scores[:, None] < scores[None, :])
    return select(detections, ~(same_face & beaten).any(axis=1))


def select(detections: Detections, keep: np.ndarray) -> Detections:
    return Detections(detections.boxes[keep], detections.scores[keep], detections.landmarks[keep])


def embed(recognizer: ort.InferenceSession, image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
    matrix = similarity_transform(landmarks, ARCFACE_TEMPLATE)
    aligned = cv2.warpAffine(image, matrix, (EMBEDDING_INPUT_SIZE, EMBEDDING_INPUT_SIZE), borderValue=0.0)
    blob = cv2.dnn.blobFromImage(aligned, 1 / 127.5, mean=(127.5, 127.5, 127.5))
    embedding = recognizer.run(None, {recognizer.get_inputs()[0].name: blob})[0][0]
    return (embedding / np.linalg.norm(embedding)).astype(np.float32)


def similarity_transform(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Least-squares rotation + uniform scale + translation (Umeyama) mapping source points onto target, as 2x3."""
    source = source.astype(np.float64)
    target = target.astype(np.float64)
    source_mean, target_mean = source.mean(axis=0), target.mean(axis=0)
    source_centered, target_centered = source - source_mean, target - target_mean
    covariance = target_centered.T @ source_centered / len(source)
    u, singular, vt = np.linalg.svd(covariance)
    reflection = np.diag([1.0, np.sign(np.linalg.det(u) * np.linalg.det(vt))])
    rotation = u @ reflection @ vt
    scale = np.trace(np.diag(singular) @ reflection) / source_centered.var(axis=0).sum()
    translation = target_mean - scale * rotation @ source_mean
    return np.hstack([scale * rotation, translation[:, None]])
