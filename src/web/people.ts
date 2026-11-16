import type { CorPessoa, Pessoa } from "./design-system/components/pessoa";

const COLORS: CorPessoa[] = ["turquesa", "laranja", "amarelo", "verde", "azul", "roxo"];

/** The same person always gets the same color: it comes from the id alone. */
export function personColor(userId: string): CorPessoa {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** A person as the design system draws them. */
export const toPessoa = (person: { id: string; name: string }, foto?: string): Pessoa => ({
  id: person.id,
  nome: person.name,
  cor: personColor(person.id),
  foto,
});
