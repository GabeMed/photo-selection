import { describe, expect, it } from "vitest";
import { addSelfie, api, groupWith, join, json, runCron, signup, uploadScripted, type Session } from "./helpers";

const tag = (user: Session, photoId: string, value: "me" | "not_me" | null) =>
  json(api(`/api/photos/${photoId}/tag`, { as: user, method: "PUT", json: { value } }));

async function unclaimedIds(user: Session, groupId: string): Promise<string[]> {
  const { photos } = await json(api(`/api/groups/${groupId}/photos?filter=unclaimed`, { as: user }));
  return photos.map((photo: any) => photo.id).sort();
}

async function unclaimedFlags(user: Session, groupId: string): Promise<Record<string, boolean>> {
  const { photos } = await json(api(`/api/groups/${groupId}/photos`, { as: user }));
  return Object.fromEntries(photos.map((photo: any) => [photo.id, photo.unclaimed]));
}

const unclaimedCount = async (user: Session, groupId: string) => (await json(api(`/api/groups/${groupId}`, { as: user }))).group.unclaimedCount;

describe("Sem dono", () => {
  it("holds analyzed photos where no member appears, by score or by tag", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    await json(addSelfie(ana, { faces: [1] }));
    const landscape = await uploadScripted(bia, group.id, { faces: [] });
    const stranger = await uploadScripted(bia, group.id, { faces: [9] });
    const ofAna = await uploadScripted(bia, group.id, { faces: [1, 9] });
    const taggedByBia = await uploadScripted(bia, group.id, { faces: [8] });
    await runCron();
    await tag(bia, taggedByBia, "me");

    expect(await unclaimedIds(ana, group.id)).toEqual([landscape, stranger].sort());
    expect(await unclaimedFlags(bia, group.id)).toEqual({ [landscape]: true, [stranger]: true, [ofAna]: false, [taggedByBia]: false });
    expect(await unclaimedCount(ana, group.id)).toBe(2);

    await tag(ana, ofAna, "not_me");
    expect(await unclaimedIds(bia, group.id)).toEqual([landscape, stranger, ofAna].sort());
    expect(await unclaimedCount(bia, group.id)).toBe(3);
  });

  it("leaves out photos still waiting for analysis or that failed", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    await uploadScripted(ana, group.id, { status: 500 });
    for (let attempt = 0; attempt < 3; attempt++) await runCron();
    await uploadScripted(ana, group.id, { faces: [] });

    const { photos } = await json(api(`/api/groups/${group.id}/photos`, { as: ana }));
    expect(photos.map((photo: any) => [photo.status, photo.unclaimed])).toEqual([
      ["recebida", false],
      ["falhou", false],
    ]);
    expect(await unclaimedIds(ana, group.id)).toEqual([]);
    expect(await unclaimedCount(ana, group.id)).toBe(0);
  });

  it("loses a photo when the person in it adds a selfie or joins later", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const ofAna = await uploadScripted(ana, group.id, { faces: [1] });
    const ofCaio = await uploadScripted(ana, group.id, { faces: [3] });
    await runCron();
    expect(await unclaimedIds(ana, group.id)).toEqual([ofAna, ofCaio].sort());

    await json(addSelfie(ana, { faces: [1] }));
    expect(await unclaimedIds(ana, group.id)).toEqual([ofCaio]);

    const caio = await signup("Caio");
    await json(addSelfie(caio, { faces: [3] }));
    expect(await unclaimedIds(ana, group.id)).toEqual([ofCaio]);
    await join(caio, group);
    expect(await unclaimedIds(ana, group.id)).toEqual([]);
  });
});
