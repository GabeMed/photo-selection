import { describe, expect, it } from "vitest";
import { personColor } from "./people";

describe("personColor", () => {
  it("gives the same id the same color every time", () => {
    expect(personColor("u_ana")).toBe(personColor("u_ana"));
  });

  it("tells two people apart", () => {
    expect(personColor("u_ana")).not.toBe(personColor("u_bia"));
  });
});
