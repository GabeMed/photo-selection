import type { Photo } from "./api";

export interface ViewerPhotos {
  /** The photos to swipe through. */
  shown: Photo[];
  /** Where `opened` is in `shown`. */
  index: number;
}

/** A photo that left the list stays on screen alone, so its tag can still be undone. */
export function viewerPhotos(photos: Photo[], opened: Photo): ViewerPhotos {
  const shown = photos.some((photo) => photo.id === opened.id) ? photos : [opened];
  return { shown, index: shown.findIndex((photo) => photo.id === opened.id) };
}
