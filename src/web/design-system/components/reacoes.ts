export const adesivosReacao = ["fogo", "amor", "risada", "uau", "olhos", "camera", "brilho", "joinha"] as const;
export type AdesivoReacao = typeof adesivosReacao[number];
export const rotulosReacao: Record<AdesivoReacao, string> = { fogo: "Fogo", amor: "Amor", risada: "Risada", uau: "Uau", olhos: "De olho", camera: "Fotão", brilho: "Brilhou", joinha: "Boa!" };
export function alternarReacao(ativas: readonly AdesivoReacao[], adesivo: AdesivoReacao): AdesivoReacao[] {
  return ativas.includes(adesivo) ? ativas.filter((a) => a !== adesivo) : [...ativas, adesivo];
}
export function normalizarProgresso(valor: number) { return Number.isFinite(valor) ? Math.min(100, Math.max(0, Math.round(valor))) : 0; }
