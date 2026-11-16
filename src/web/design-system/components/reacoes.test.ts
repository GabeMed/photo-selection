import { describe, expect, it } from "vitest";
import { adesivosReacao, alternarReacao, normalizarProgresso } from "./reacoes";
describe("sticker reactions and progress", () => {
  it("provides exactly eight sticker choices", () => { expect(adesivosReacao).toEqual(["fogo", "amor", "risada", "uau", "olhos", "camera", "brilho", "joinha"]); });
  it("toggles a reaction without adding counts or duplicates", () => { expect(alternarReacao(["amor"], "amor")).toEqual([]); expect(alternarReacao([], "amor")).toEqual(["amor"]); });
  it("reports bounded 0–100 upload progress", () => { expect(normalizarProgresso(62)).toBe(62); expect(normalizarProgresso(108)).toBe(100); expect(normalizarProgresso(-4)).toBe(0); });
});
