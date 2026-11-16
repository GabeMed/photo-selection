import sys
import urllib.request
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import app  # noqa: E402

CACHE_DIR = Path(__file__).resolve().parent / ".cache"
# Pinned by commit, so the images the assertions were measured on cannot change under the tests.
FACE_RECOGNITION_EXAMPLES = (
    "https://raw.githubusercontent.com/ageitgey/face_recognition/9f3061aaeed9a8756d2c970f5dfe066617a8281d/examples/"
)
INSIGHTFACE_SAMPLE = (
    "https://raw.githubusercontent.com/deepinsight/insightface/c6c3af7bd2d0a0bf4b78c78437357f3521aa5d52"
    "/python-package/insightface/data/images/t1.jpg"
)
PUBLIC_IMAGES = {
    "obama.jpg": FACE_RECOGNITION_EXAMPLES + "obama.jpg",
    "obama2.jpg": FACE_RECOGNITION_EXAMPLES + "obama2.jpg",
    "biden.jpg": FACE_RECOGNITION_EXAMPLES + "biden.jpg",
    "two_people.jpg": FACE_RECOGNITION_EXAMPLES + "two_people.jpg",
    "group.jpg": INSIGHTFACE_SAMPLE,
}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def models(client):
    return client.app.state.models


@pytest.fixture(scope="session")
def public_image():
    def load(name: str) -> bytes:
        path = CACHE_DIR / name
        if not path.exists():
            CACHE_DIR.mkdir(exist_ok=True)
            urllib.request.urlretrieve(PUBLIC_IMAGES[name], path)
        return path.read_bytes()

    return load
