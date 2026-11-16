import { describe, expect, it } from "vitest";
import type { PhotoPage } from "./api";
import { fetchThrough, mergePhotos, notDownloaded, withDownloaded } from "./photoList";
import { photoOf } from "./testing";

const at = (id: string, minute: number, fields = {}) =>
  photoOf({ id, createdAt: `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`, ...fields });

const ids = (photos: { id: string }[]) => photos.map((photo) => photo.id);

describe("mergePhotos", () => {
  it("replaces a photo with the same id and keeps the API order: most recent first, ties by id", () => {
    const current = [at("c", 3), at("b", 2, { status: "recebida" }), at("a", 1)];
    const merged = mergePhotos(current, [at("b", 2, { status: "processada" }), at("e", 4), at("d", 4), at("z", 0)]);
    expect(ids(merged)).toEqual(["e", "d", "c", "b", "a", "z"]);
    expect(merged.find((photo) => photo.id === "b")!.status).toBe("processada");
    expect(merged).toHaveLength(6);
  });
});

describe("fetchThrough", () => {
  // Five photos, newest first, served two per page.
  const server = [at("e", 5), at("d", 4), at("c", 3), at("b", 2), at("a", 1)];
  const pagesOf = (photos = server) => {
    const cursors: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<PhotoPage> => {
      cursors.push(cursor);
      const start = Number(cursor ?? 0);
      const next = start + 2;
      return { photos: photos.slice(start, next), nextCursor: next < photos.length ? String(next) : null };
    };
    return { fetchPage, cursors };
  };

  it("reads a single page when nothing is loaded yet", async () => {
    const { fetchPage, cursors } = pagesOf();
    expect(await fetchThrough(fetchPage, undefined)).toEqual({ photos: server.slice(0, 2), nextCursor: "2" });
    expect(cursors).toEqual([undefined]);
  });

  it("walks the pages until it covers the oldest loaded photo, and leaves the cursor after it", async () => {
    const { fetchPage, cursors } = pagesOf();
    const fresh = await fetchThrough(fetchPage, at("c", 3));
    expect(ids(fresh.photos)).toEqual(["e", "d", "c", "b"]);
    expect(fresh.nextCursor).toBe("4");
    expect(cursors).toEqual([undefined, "2"]);
  });

  it("leaves out a loaded photo that someone deleted, inside the range it read", async () => {
    const { fetchPage } = pagesOf(server.filter((photo) => photo.id !== "d"));
    const fresh = await fetchThrough(fetchPage, at("b", 2));
    expect(ids(fresh.photos)).toEqual(["e", "c", "b", "a"]);
    expect(fresh.nextCursor).toBeNull();
  });

  it("stops at the end of the list when the oldest loaded photo is gone", async () => {
    const { fetchPage, cursors } = pagesOf(server.slice(0, 3));
    const fresh = await fetchThrough(fetchPage, at("a", 1));
    expect(ids(fresh.photos)).toEqual(["e", "d", "c"]);
    expect(cursors).toEqual([undefined, "2"]);
  });
});

describe("download history in the list", () => {
  const list = [at("c", 3, { downloaded: true }), at("b", 2), at("a", 1)];

  it("counts as new only what I have not downloaded", () => {
    expect(ids(notDownloaded(list))).toEqual(["b", "a"]);
  });

  it("keeps a photo known as downloaded so when an older answer says otherwise", () => {
    const marked = withDownloaded(list, new Set(["b"]));
    expect(marked.map((photo) => photo.downloaded)).toEqual([true, true, false]);
    expect(marked[2]).toBe(list[2]);
    expect(ids(notDownloaded(marked))).toEqual(["a"]);
  });
});
