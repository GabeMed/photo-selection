import { describe, expect, it } from "vitest";
import { safeNextPath } from "./format";

const ORIGIN = "https://photos.test";

describe("safeNextPath", () => {
  it("keeps a path of the site, with its query and fragment", () => {
    expect(safeNextPath("/g/1", ORIGIN)).toBe("/g/1");
    expect(safeNextPath("/j/abc?x=1#top", ORIGIN)).toBe("/j/abc?x=1#top");
    expect(safeNextPath(`${ORIGIN}/perfil`, ORIGIN)).toBe("/perfil");
  });

  it("falls back to the home page for anything that would leave the site", () => {
    const hostile = ["//evil.com", "/\\evil.com", "/\t/evil.com", "/.//evil.com", "https://evil.com", "javascript:alert(1)", "http://[", "", null];
    for (const next of hostile) expect(safeNextPath(next, ORIGIN), JSON.stringify(next)).toBe("/");
  });
});
