import * as api from "./api";
import type { Photo } from "./api";

const MIB = 1024 ** 2;

/** A share batch holds its originals in memory: few photos and few bytes, whichever limit comes first. */
export const SHARE_BATCH_MAX_PHOTOS = 10;
export const SHARE_BATCH_MAX_BYTES = 150 * MIB;
/** The ZIP is read whole into memory before it is saved; above this the person is warned first. */
export const ZIP_WARNING_BYTES = 500 * MIB;

export const totalBytes = (photos: Photo[]) => photos.reduce((total, photo) => total + photo.sizeBytes, 0);

/** iPhone and iPad, where the share sheet saves to the photo library. iPadOS presents itself as a Mac with touch. */
export function isAppleTouchDevice(): boolean {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** True where the share sheet is the main way to save photos: an Apple touch device that shares files. */
export function sharesToPhotoLibrary(): boolean {
  if (!isAppleTouchDevice() || typeof navigator.canShare !== "function") return false;
  return navigator.canShare({ files: [new File([""], "foto.jpg", { type: "image/jpeg" })] });
}

/** Consecutive photos, each batch within both limits; a photo above the byte limit goes alone. */
export function splitIntoBatches(photos: Photo[], maxPhotos: number, maxBytes: number): Photo[][] {
  const batches: Photo[][] = [];
  let batch: Photo[] = [];
  for (const photo of photos) {
    const full = batch.length === maxPhotos || (batch.length > 0 && totalBytes(batch) + photo.sizeBytes > maxBytes);
    if (full) {
      batches.push(batch);
      batch = [];
    }
    batch.push(photo);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** The API builds a ZIP inside one group, so everything downloaded together is split by group first. */
export function splitByGroup(photos: Photo[]): Photo[][] {
  const byGroup = new Map<string, Photo[]>();
  for (const photo of photos) byGroup.set(photo.groupId, [...(byGroup.get(photo.groupId) ?? []), photo]);
  return [...byGroup.values()];
}

/** Share batches never mix groups, so a batch the device refuses to share can leave as one ZIP. */
export const shareBatches = (photos: Photo[]) =>
  splitByGroup(photos).flatMap((ofGroup) => splitIntoBatches(ofGroup, SHARE_BATCH_MAX_PHOTOS, SHARE_BATCH_MAX_BYTES));

export async function fetchOriginalFile(photo: Photo): Promise<File> {
  const blob = await api.downloadOriginal(photo);
  return new File([blob], photo.filename, { type: blob.type });
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Safari reads the blob after the click returns, so the URL has to outlive it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** What a thumbnail's corner shows: the seal once I downloaded it, else a quick download once the original exists. */
export function downloadCorner(photo: Photo): "seal" | "button" | "none" {
  if (photo.downloaded) return "seal";
  if (photo.status === "enviando") return "none";
  return "button";
}

/** The last single original asked for; the next one waits for it, saved or failed. */
let previousOriginal: Promise<void> = Promise.resolve();

/**
 * The one way to download a single original, from the grid and from the open photo. The file
 * passes through memory, so originals are fetched one at a time, in the order they were asked
 * for; only a saved file shows as downloaded.
 */
export function saveOriginal(photo: Photo, onSaved: (photos: Photo[]) => void): Promise<void> {
  const download = previousOriginal
    .catch(() => undefined)
    .then(async () => {
      saveBlob(await api.downloadAndRecordOriginal(photo), photo.filename);
      onSaved([photo]);
    });
  previousOriginal = download;
  return download;
}

/** Photos of a single group, saved as one ZIP. */
export async function saveZip(photos: Photo[], groupName: string): Promise<void> {
  const photoIds = photos.map((photo) => photo.id);
  saveBlob(await api.downloadZip(photos[0].groupId, photoIds), `${groupName}.zip`);
}
