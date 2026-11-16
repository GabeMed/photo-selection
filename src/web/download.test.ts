import { describe, expect, it } from "vitest";
import { shareBatches, SHARE_BATCH_MAX_BYTES, SHARE_BATCH_MAX_PHOTOS, splitIntoBatches } from "./download";
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
