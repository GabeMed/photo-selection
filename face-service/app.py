"""HTTP face service: opens an image, returns its faces plus the preview and thumbnail JPEGs."""

import asyncio
import base64
import io
import os
import struct
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

from faces import Face, FaceModels, find_faces, load_models

PREVIEW_MAX_SIDE = 2048
THUMB_MAX_SIDE = 400
PREVIEW_JPEG_QUALITY = 85
THUMB_JPEG_QUALITY = 80
ACCEPTED_FORMATS = ["JPEG", "PNG", "WEBP", "HEIF"]
# Pillow keeps the source profile through the conversion to RGB, where a grey or CMYK profile is wrong.
MODES_WITH_RGB_PROFILE = ("RGB", "RGBA")
MAX_CONCURRENT_ANALYSES = 2

register_heif_opener()


class UnreadableImage(Exception):
    pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    # uvicorn only starts accepting connections after this returns, so /health answers only with models loaded.
    app.state.models = load_models(Path(os.environ["MODELS_DIR"]), threads=int(os.environ.get("FACE_THREADS", "2")))
    app.state.tiles = os.environ.get("FACE_TILES", "0") == "1"
    app.state.analysis_slots = asyncio.Semaphore(MAX_CONCURRENT_ANALYSES)
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(request: Request) -> JSONResponse:
    body = await request.body()
    state = request.app.state
    try:
        async with state.analysis_slots:
            result = await run_in_threadpool(analyze_image, state.models, body, state.tiles)
    except UnreadableImage as error:
        return JSONResponse(status_code=422, content={"error": str(error)})
    return JSONResponse(content=result)


def analyze_image(models: FaceModels, body: bytes, tiles: bool) -> dict:
    image = open_oriented_rgb(body)
    faces = find_faces(models, np.asarray(image), tiles)
    preview = reduced(image, PREVIEW_MAX_SIDE)
    return {
        "width": image.width,
        "height": image.height,
        "faces": [serialize_face(face, image.width, image.height) for face in faces],
        "preview_b64": jpeg_base64(preview, PREVIEW_JPEG_QUALITY),
        "thumb_b64": jpeg_base64(reduced(preview, THUMB_MAX_SIDE), THUMB_JPEG_QUALITY),
    }


def open_oriented_rgb(body: bytes) -> Image.Image:
    try:
        source = Image.open(io.BytesIO(body), formats=ACCEPTED_FORMATS)
        oriented = ImageOps.exif_transpose(source).convert("RGB")
    # What Pillow and its plugins raise on truncated or corrupt files, beyond UnidentifiedImageError (an OSError);
    # RuntimeError is how pillow-heif reports a libheif decoding failure.
    except (OSError, ValueError, SyntaxError, EOFError, RuntimeError, struct.error, Image.DecompressionBombError) as error:
        raise UnreadableImage("could not read image") from error
    # Without the source profile, the JPEGs of wide-gamut photos (Display P3 from phones) come out washed out.
    oriented.info["icc_profile"] = source.info.get("icc_profile") if source.mode in MODES_WITH_RGB_PROFILE else None
    return oriented


def serialize_face(face: Face, width: int, height: int) -> dict:
    x0, y0, x1, y1 = np.clip(face.box / [width, height, width, height], 0.0, 1.0).tolist()
    return {
        "box": [x0, y0, x1 - x0, y1 - y0],
        "det_score": face.det_score,
        "embedding_b64": base64.b64encode(face.embedding.astype("<f4").tobytes()).decode("ascii"),
    }


def reduced(image: Image.Image, max_side: int) -> Image.Image:
    """A copy whose longest side is at most max_side; never enlarged. Keeps the colour profile."""
    scale = min(1.0, max_side / max(image.size))
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    # reducing_gap lets Pillow shrink by whole factors first: no full-size intermediate copy.
    return image.resize(size, Image.Resampling.LANCZOS, reducing_gap=2.0)


def jpeg_base64(image: Image.Image, quality: int) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, icc_profile=image.info["icc_profile"])
    return base64.b64encode(buffer.getvalue()).decode("ascii")
