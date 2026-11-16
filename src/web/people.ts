import type { CorPessoa, Pessoa } from "./design-system/components/pessoa";

const COLORS: CorPessoa[] = ["turquesa", "laranja", "amarelo", "verde", "azul", "roxo"];

interface Person {
  id: string;
  name: string;
}

/** Turns a person into the design system's `Pessoa`, with the color the current page gives them. */
export type PersonOf = (person: Person) => Pessoa;

/** Outside a group: the same person always gets the same color, from the id alone. */
export function personColor(userId: string): CorPessoa {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** A person as the design system draws them, outside a group. */
export const toPessoa = (person: Person, foto?: string): Pessoa => ({
  id: person.id,
  nome: person.name,
  cor: personColor(person.id),
  foto,
});

/**
 * Inside a group: colors follow the members' join order, so the first six people never share one.
 * `members` must be in join order, as the API lists them.
 */
export function groupPersonOf(members: Person[]): PersonOf {
  const colorById = new Map(members.map((member, index) => [member.id, COLORS[index % COLORS.length]]));
  // Someone missing from the list (who joined after it was read) keeps their color from outside the group.
  return (person) => ({ id: person.id, nome: person.name, cor: colorById.get(person.id) ?? personColor(person.id) });
}
