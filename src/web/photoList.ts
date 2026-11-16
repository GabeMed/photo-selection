import type { Photo, PhotoPage } from "./api";

/** Same order as the API: most recent first, ties broken by id. */
export function recentFirst(a: Photo, b: Photo): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

export function mergePhotos(current: Photo[], incoming: Photo[]): Photo[] {
  const byId = new Map(current.map((photo) => [photo.id, photo]));
  for (const photo of incoming) byId.set(photo.id, photo);
  return [...byId.values()].sort(recentFirst);
}

/** A download is never undone, so a photo known as downloaded here stays so whatever an older answer says. */
export const withDownloaded = (photos: Photo[], downloadedIds: ReadonlySet<string>) =>
  photos.map((photo) => (!photo.downloaded && downloadedIds.has(photo.id) ? { ...photo, downloaded: true } : photo));

/**
 * Reads the list again from its start down to `oldestLoaded`, page by page. The answer replaces
 * everything loaded: a loaded photo that is missing from it was deleted, or left the filter.
 */
export async function fetchThrough(fetchPage: (cursor?: string) => Promise<PhotoPage>, oldestLoaded: Photo | undefined): Promise<PhotoPage> {
  const photos: Photo[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    photos.push(...page.photos);
    const last = page.photos.at(-1);
    const covered = !oldestLoaded || !last || recentFirst(last, oldestLoaded) >= 0;
    if (covered || page.nextCursor === null) return { photos, nextCursor: page.nextCursor };
    cursor = page.nextCursor;
  }
}
