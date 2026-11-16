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

/** Photos of a single group, saved as one ZIP. */
export async function saveZip(photos: Photo[], groupName: string): Promise<void> {
  const photoIds = photos.map((photo) => photo.id);
  saveBlob(await api.downloadZip(photos[0].groupId, photoIds), `${groupName}.zip`);
}
