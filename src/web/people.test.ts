import { describe, expect, it } from "vitest";
import { groupPersonOf, personColor } from "./people";

describe("personColor", () => {
  it("gives the same id the same color every time", () => {
    expect(personColor("u_ana")).toBe(personColor("u_ana"));
  });

  it("tells two people apart", () => {
    expect(personColor("u_ana")).not.toBe(personColor("u_bia"));
  });
});

/** Ids that would all get the same color if the color came from the id alone. */
function idsWithTheSameColor(count: number): string[] {
  const ids = Array.from({ length: 200 }, (_, index) => `u_${index}`);
  const sameColor = ids.filter((id) => personColor(id) === personColor(ids[0]));
  return sameColor.slice(0, count);
}

describe("groupPersonOf", () => {
  const members = idsWithTheSameColor(8).map((id, index) => ({ id, name: `Pessoa ${index + 1}` }));
  const personOf = groupPersonOf(members);
  const colors = members.map((member) => personOf(member).cor);

  it("gives the first six members six different colors, even when their ids would share one", () => {
    expect(members).toHaveLength(8);
    expect(new Set(colors.slice(0, 6)).size).toBe(6);
  });

  it("starts the colors over from the seventh member on", () => {
    expect(colors.slice(6)).toEqual(colors.slice(0, 2));
  });

  it("gives a member the same color wherever they show up on the page", () => {
    const uploader = { id: members[3].id, name: members[3].name };
    expect(personOf(uploader)).toEqual(personOf(members[3]));
    expect(personOf(uploader)).toMatchObject({ id: members[3].id, nome: "Pessoa 4" });
  });

  it("depends on the join order, not on the ids", () => {
    const reversed = groupPersonOf([...members].reverse());
    expect(reversed(members[7]).cor).toBe(colors[0]);
  });
});
