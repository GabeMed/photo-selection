import { describe, expect, it } from "vitest";
import { corCarimbo, nomeNoCarimbo, rotacaoCarimbo } from "./CarimboViagem";
describe("rotacaoCarimbo", () => {
  it("keeps the stamp tilt between -6 and 6 degrees", () => {
    for (const n of ["Chapada 2026", "Jeri", "Ilhabela dos crias", "", "Á"]) { const r = rotacaoCarimbo(n); expect(r).toBeGreaterThanOrEqual(-6); expect(r).toBeLessThanOrEqual(6); }
  });
  it("is stable for the same trip", () => { expect(rotacaoCarimbo("Jeri")).toBe(rotacaoCarimbo("Jeri")); });
});
describe("nomeNoCarimbo", () => {
  it("keeps a name that fits the arc", () => { expect(nomeNoCarimbo("Chapada 2026")).toBe("Chapada 2026"); });
  it("cuts a long name with an ellipsis", () => {
    const cortado = nomeNoCarimbo("Réveillon em Trancoso com a família toda 2026");
    expect(cortado).toBe("Réveillon em Tr…");
    expect(cortado).toHaveLength(16);
  });
  it("keeps a name of exactly sixteen letters whole", () => { expect(nomeNoCarimbo("Praia do Rosa 26")).toBe("Praia do Rosa 26"); });
  it("never cuts an emoji in half", () => { expect(nomeNoCarimbo("Chapada dos Ve🌵adeiros")).toBe("Chapada dos Ve🌵…"); });
});
describe("corCarimbo", () => {
  it("gives the same trip the same ink every time", () => { expect(corCarimbo("g_123")).toBe(corCarimbo("g_123")); });
  it("spreads trips over every ink", () => {
    const tintas = new Set(Array.from({ length: 50 }, (_, i) => corCarimbo(`g_${i}`)));
    expect(tintas.size).toBe(7);
  });
});
