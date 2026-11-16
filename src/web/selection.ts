import type { Photo } from "./api";

export const allSelected = (photos: Photo[], selectedIds: ReadonlySet<string>) =>
  photos.length > 0 && photos.every((photo) => selectedIds.has(photo.id));

/** The "select all" toggle: selects every photo shown, or clears the selection once all of them are selected. */
export const toggledAll = (photos: Photo[], selectedIds: ReadonlySet<string>): ReadonlySet<string> =>
  allSelected(photos, selectedIds) ? new Set() : new Set(photos.map((photo) => photo.id));
