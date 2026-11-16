import { describe, expect, it } from "vitest";
import { photoOf } from "./testing";
import { viewerPhotos } from "./viewerPhotos";

describe("viewerPhotos", () => {
  const list = [photoOf({ id: "a" }), photoOf({ id: "b" }), photoOf({ id: "c" })];

  it("swipes through the list from the opened photo", () => {
    const { shown, index } = viewerPhotos(list, photoOf({ id: "b" }));
    expect(shown).toBe(list);
    expect(index).toBe(1);
  });

  it("keeps a photo that left the list on screen alone", () => {
    const opened = photoOf({ id: "gone" });
    const { shown, index } = viewerPhotos(list, opened);
    expect(shown).toEqual([opened]);
    expect(index).toBe(0);
  });
});
