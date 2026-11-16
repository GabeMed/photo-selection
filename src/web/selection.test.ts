import { describe, expect, it } from "vitest";
import { allSelected, toggledAll } from "./selection";
import { photoOf } from "./testing";

const shown = ["a", "b", "c"].map((id) => photoOf({ id }));

describe("select all toggle", () => {
  it("selects every photo shown when none is selected", () => {
    expect([...toggledAll(shown, new Set())]).toEqual(["a", "b", "c"]);
  });

  it("selects every photo shown when only some are", () => {
    expect([...toggledAll(shown, new Set(["b"]))]).toEqual(["a", "b", "c"]);
  });

  it("clears the selection when every photo shown is selected", () => {
    expect(allSelected(shown, new Set(["a", "b", "c"]))).toBe(true);
    expect(toggledAll(shown, new Set(["a", "b", "c"])).size).toBe(0);
  });

  it("selects only the photos shown, dropping a selected one that left the list", () => {
    expect(allSelected(shown, new Set(["a", "b", "x"]))).toBe(false);
    expect([...toggledAll(shown, new Set(["a", "b", "x"]))]).toEqual(["a", "b", "c"]);
  });

  it("is never pressed for an empty list", () => {
    expect(allSelected([], new Set())).toBe(false);
  });
});
