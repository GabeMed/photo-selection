export type CorPessoa = "turquesa" | "laranja" | "amarelo" | "verde" | "azul" | "roxo";

export interface Pessoa {
  id: string;
  nome: string;
  cor: CorPessoa;
  foto?: string;
}

/** Static class maps so Tailwind keeps every person color. */
export const corFundo: Record<CorPessoa, string> = {
  turquesa: "bg-pessoa-turquesa",
  laranja: "bg-pessoa-laranja",
  amarelo: "bg-pessoa-amarelo",
  verde: "bg-pessoa-verde",
  azul: "bg-pessoa-azul",
  roxo: "bg-pessoa-roxo",
};
