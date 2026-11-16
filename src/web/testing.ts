import type { Photo } from "./api";

/** A photo for tests: only the fields a test cares about are given. */
export function photoOf(fields: Partial<Photo> & { id: string }): Photo {
  return {
    groupId: "g1",
    uploaderId: "u1",
    uploaderName: "Ana",
    filename: `${fields.id}.jpg`,
    sizeBytes: 1,
    width: null,
    height: null,
    status: "processada",
    createdAt: "2026-01-01T00:00:00.000Z",
    thumbUrl: null,
    previewUrl: null,
    originalUrl: `/api/photos/${fields.id}/original`,
    mine: false,
    myTag: null,
    downloaded: false,
    unclaimed: false,
    canDelete: false,
    ...fields,
  };
}
