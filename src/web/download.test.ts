import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCorner, saveOriginal, shareBatches, SHARE_BATCH_MAX_BYTES, SHARE_BATCH_MAX_PHOTOS, splitIntoBatches } from "./download";
import type { Photo } from "./api";
import { photoOf } from "./testing";

const sized = (sizes: number[], groupId = "g1") => sizes.map((sizeBytes, index) => photoOf({ id: `${groupId}-${index}`, groupId, sizeBytes }));

const sizesOf = (batches: { sizeBytes: number }[][]) => batches.map((batch) => batch.map((photo) => photo.sizeBytes));

describe("splitIntoBatches", () => {
  it("closes a batch at the photo count", () => {
    expect(sizesOf(splitIntoBatches(sized([1, 1, 1, 1, 1, 1, 1]), 3, 100))).toEqual([[1, 1, 1], [1, 1, 1], [1]]);
  });

  it("closes a batch before the bytes pass the limit, whichever limit comes first", () => {
    expect(sizesOf(splitIntoBatches(sized([40, 40, 40, 10, 10, 10, 10]), 3, 100))).toEqual([[40, 40], [40, 10, 10], [10, 10]]);
    expect(sizesOf(splitIntoBatches(sized([50, 50, 1]), 3, 100))).toEqual([[50, 50], [1]]);
  });

  it("sends alone a photo that is larger than the byte limit, keeping the order", () => {
    expect(sizesOf(splitIntoBatches(sized([10, 250, 10]), 3, 100))).toEqual([[10], [250], [10]]);
  });

  it("returns no batch for no photo", () => {
    expect(splitIntoBatches([], 3, 100)).toEqual([]);
  });
});

describe("shareBatches", () => {
  it("never mixes groups and applies the limits of the share sheet", () => {
    const half = SHARE_BATCH_MAX_BYTES / 2;
    const batches = shareBatches([...sized(Array(SHARE_BATCH_MAX_PHOTOS + 1).fill(1), "g1"), ...sized([half, half, half], "g2")]);
    expect(batches.map((batch) => batch.map((photo) => photo.groupId).join(""))).toEqual(["g1".repeat(SHARE_BATCH_MAX_PHOTOS), "g1", "g2g2", "g2"]);
  });
});

describe("downloadCorner", () => {
  it("shows the seal on a photo I downloaded, a button on one I did not, and nothing while the original is still uploading", () => {
    expect(downloadCorner(photoOf({ id: "a", downloaded: true }))).toBe("seal");
    expect(downloadCorner(photoOf({ id: "b", status: "recebida" }))).toBe("button");
    expect(downloadCorner(photoOf({ id: "c", status: "falhou" }))).toBe("button");
    expect(downloadCorner(photoOf({ id: "d", status: "enviando" }))).toBe("none");
  });
});

describe("saveOriginal", () => {
  const photo = photoOf({ id: "p1", filename: "praia.jpg" });
  let link: { href: string; download: string; click: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    link = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: () => link });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:p1");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks for the recorded original, saves it under the photo's name, and only then marks it", async () => {
    const fetch = vi.fn(async () => new Response(new Blob(["bytes"])));
    vi.stubGlobal("fetch", fetch);
    const onSaved = vi.fn(() => expect(link.click).toHaveBeenCalled());
    await saveOriginal(photo, onSaved);
    expect(fetch).toHaveBeenCalledWith("/api/photos/p1/original", undefined);
    expect(link.download).toBe("praia.jpg");
    expect(onSaved).toHaveBeenCalledWith([photo]);
  });

  it("neither saves nor marks when the original does not arrive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":"not_found","message":"Não achei."}}', { status: 404 })));
    const onSaved = vi.fn();
    await expect(saveOriginal(photo, onSaved)).rejects.toMatchObject({ status: 404 });
    expect(link.click).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("fetches one original at a time: the next starts only once the one before was saved", async () => {
    const answers: ((response: Response) => void)[] = [];
    const fetch = vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve)));
    vi.stubGlobal("fetch", fetch);
    const saved: string[] = [];
    const onSaved = (photos: Photo[]) => saved.push(photos[0].id);
    const first = saveOriginal(photoOf({ id: "p1" }), onSaved);
    const second = saveOriginal(photoOf({ id: "p2" }), onSaved);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetch).toHaveBeenCalledTimes(1);
    answers[0](new Response(new Blob(["one"])));
    await first;
    expect(saved).toEqual(["p1"]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenLastCalledWith("/api/photos/p2/original", undefined);
    answers[1](new Response(new Blob(["two"])));
    await second;
    expect(saved).toEqual(["p1", "p2"]);
  });

  it("goes on to the next original when the one before fails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response(new Blob(["two"])));
    vi.stubGlobal("fetch", fetch);
    const onSaved = vi.fn();
    const first = saveOriginal(photoOf({ id: "p1" }), onSaved);
    const second = saveOriginal(photoOf({ id: "p2" }), onSaved);
    await expect(first).rejects.toMatchObject({ status: 500 });
    await second;
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith([expect.objectContaining({ id: "p2" })]);
  });
});
