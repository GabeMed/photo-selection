import { describe, expect, it } from "vitest";
import { rotacaoCarimbo } from "./CarimboViagem";
describe("rotacaoCarimbo", () => {
  it("keeps the stamp tilt between -6 and 6 degrees", () => {
    for (const n of ["Chapada 2026", "Jeri", "Ilhabela dos crias", "", "Á"]) { const r = rotacaoCarimbo(n); expect(r).toBeGreaterThanOrEqual(-6); expect(r).toBeLessThanOrEqual(6); }
  });
  it("is stable for the same trip", () => { expect(rotacaoCarimbo("Jeri")).toBe(rotacaoCarimbo("Jeri")); });
});
