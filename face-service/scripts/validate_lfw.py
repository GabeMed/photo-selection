"""Optional check of detection + recognition on the 6000 verification pairs of LFW. Not part of the test suite.

Usage: MODELS_DIR=models .venv/bin/python scripts/validate_lfw.py
Downloads about 245 MB into scripts/.lfw/ (ignored by git) on the first run.
"""

import hashlib
import os
import sys
import tarfile
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from faces import FaceModels, find_faces, load_models  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent / ".lfw"
# The copies scikit-learn downloads; the dataset's original host no longer serves them.
DOWNLOADS = {
    "lfw-funneled.tgz": (
        "https://ndownloader.figshare.com/files/5976015",
        "b47c8422c8cded889dc5a13418c4bc2abbda121092b3533a83306f90d900100a",
    ),
    "pairs.txt": (
        "https://ndownloader.figshare.com/files/5976006",
        "ea42330c62c92989f9d7c03237ed5d591365e89b3e649747777b70e692dc1592",
    ),
}
THRESHOLDS = (0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55)
PERCENTILES = (0, 1, 5, 50, 95, 99, 100)

Pair = tuple[Path, Path, bool]


def downloaded(name: str) -> Path:
    url, sha256 = DOWNLOADS[name]
    path = DATA_DIR / name
    if not path.exists():
        DATA_DIR.mkdir(exist_ok=True)
        urllib.request.urlretrieve(url, path)
    if hashlib.sha256(path.read_bytes()).hexdigest() != sha256:
        raise ValueError(f"{path} does not have the expected SHA-256; delete it and run again")
    return path


def images_dir() -> Path:
    directory = DATA_DIR / "lfw_funneled"
    if not directory.exists():
        with tarfile.open(downloaded("lfw-funneled.tgz")) as archive:
            archive.extractall(DATA_DIR, filter="data")
    return directory


def read_pairs(pairs_file: Path, images: Path) -> list[Pair]:
    def image(person: str, number: str) -> Path:
        return images / person / f"{person}_{int(number):04d}.jpg"

    def pair(fields: list[str]) -> Pair:
        if len(fields) == 3:
            return image(fields[0], fields[1]), image(fields[0], fields[2]), True
        return image(fields[0], fields[1]), image(fields[2], fields[3]), False

    return [pair(line.split()) for line in pairs_file.read_text().splitlines()[1:]]


def central_embedding(models: FaceModels, path: Path) -> np.ndarray | None:
    """The face nearest the centre is the person the image is labelled with; None when no face is found."""
    image = np.asarray(Image.open(path).convert("RGB"))
    faces = find_faces(models, image, tiles=False)
    if not faces:
        return None
    center = np.array(image.shape[1::-1]) / 2
    return min(faces, key=lambda face: np.abs((face.box[:2] + face.box[2:]) / 2 - center).sum()).embedding


def cosines(pairs: list[Pair], embeddings: dict[Path, np.ndarray | None], same: bool) -> np.ndarray:
    scored = [(embeddings[first], embeddings[second]) for first, second, is_same in pairs if is_same == same]
    return np.array([float(first @ second) for first, second in scored if first is not None and second is not None])


def main() -> None:
    models = load_models(Path(os.environ["MODELS_DIR"]), threads=os.cpu_count())
    pairs = read_pairs(downloaded("pairs.txt"), images_dir())
    paths = sorted({path for first, second, _ in pairs for path in (first, second)})
    embeddings = {path: central_embedding(models, path) for path in paths}
    same, different = cosines(pairs, embeddings, True), cosines(pairs, embeddings, False)

    missed = sum(embedding is None for embedding in embeddings.values())
    print(f"images: {len(paths)}; without a detected face: {missed}")
    print(f"pairs scored: {len(same)} same person, {len(different)} different people")
    print(f"percentiles {PERCENTILES}")
    print(f"  same person:      {np.percentile(same, PERCENTILES).round(3).tolist()}")
    print(f"  different people: {np.percentile(different, PERCENTILES).round(3).tolist()}")
    for threshold in THRESHOLDS:
        accepted_same, accepted_different = (same >= threshold).mean(), (different >= threshold).mean()
        print(f"threshold {threshold:.2f}: same accepted {accepted_same:.4f}, different accepted {accepted_different:.4f}")


if __name__ == "__main__":
    main()
