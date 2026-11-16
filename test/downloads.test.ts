import { describe, expect, it } from "vitest";
import { api, createGroup, env, groupWith, join, json, signup, randomBytes, runCron, upload, uploadScripted, type Session } from "./helpers";

async function downloadsOf(user: Session): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT photo_id, downloaded_at FROM downloads WHERE user_id = ?1")
    .bind(user.id)
    .all<{ photo_id: string; downloaded_at: string }>();
  return Object.fromEntries(results.map((row) => [row.photo_id, row.downloaded_at]));
}

async function downloadedFlags(user: Session, groupId: string, query = ""): Promise<[string, boolean][]> {
  const { photos } = await json(api(`/api/groups/${groupId}/photos${query}`, { as: user }));
  return photos.map((photo: any) => [photo.id, photo.downloaded]);
}

const fetchOriginal = async (user: Session, photoId: string) => (await api(`/api/photos/${photoId}/original`, { as: user })).arrayBuffer();
const fetchZip = async (user: Session, groupId: string, photoIds: string[]) =>
  (await api(`/api/groups/${groupId}/download`, { as: user, json: { photoIds } })).arrayBuffer();

describe("download history", () => {
  it("does not record an original fetched for the share sheet until the page reports the sheet took it", async () => {
    const { admin, group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const photoId = await upload(ana, group.id, randomBytes(10));
    const other = await createGroup(admin, "Outra viagem");
    const caio = await signup("Caio");
    await join(caio, other);
    const foreign = await upload(caio, other.id, randomBytes(10));

    await (await api(`/api/photos/${photoId}/original?record=0`, { as: bia })).arrayBuffer();
    expect(await downloadsOf(bia)).toEqual({});

    const reported = await api("/api/downloads", { as: bia, json: { photoIds: [photoId, foreign] } });
    expect(reported.status).toBe(204);
    expect(Object.keys(await downloadsOf(bia))).toEqual([photoId]);
  });

  it("records a single original, only for who asked, and shows it only to them", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const photoId = await upload(ana, group.id, randomBytes(10));

    await fetchOriginal(bia, photoId);

    expect(Object.keys(await downloadsOf(bia))).toEqual([photoId]);
    expect(await downloadedFlags(bia, group.id)).toEqual([[photoId, true]]);
    expect(await downloadedFlags(ana, group.id)).toEqual([[photoId, false]]);
    const tagged = await json(api(`/api/photos/${photoId}/tag`, { as: ana, method: "PUT", json: { value: "me" } }));
    expect(tagged.photo.downloaded).toBe(false);
  });

  it("records every photo of a ZIP and keeps the first date on a second download", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const first = await upload(ana, group.id, randomBytes(10));
    const second = await upload(ana, group.id, randomBytes(10));
    const left = await upload(ana, group.id, randomBytes(10));

    await fetchZip(ana, group.id, [first, second]);
    const recorded = await downloadsOf(ana);
    expect(Object.keys(recorded).sort()).toEqual([first, second].sort());

    await scheduler.wait(5);
    await fetchOriginal(ana, first);
    await fetchZip(ana, group.id, [first, second, left]);
    const after = await downloadsOf(ana);
    expect(after[first]).toBe(recorded[first]);
    expect(after[second]).toBe(recorded[second]);
    expect(Object.keys(after)).toHaveLength(3);
  });

  it("does not record a thumbnail or a preview", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const photoId = await uploadScripted(ana, group.id, { faces: [] });
    await runCron();

    expect((await api(`/api/photos/${photoId}/thumb`, { as: ana })).status).toBe(200);
    expect((await api(`/api/photos/${photoId}/preview`, { as: ana })).status).toBe(200);
    expect(await downloadsOf(ana)).toEqual({});
  });

  it("does not record a refused ZIP", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const photoId = await upload(ana, group.id, randomBytes(10));
    expect((await api(`/api/groups/${group.id}/download`, { as: ana, json: { photoIds: [photoId, "missing"] } })).status).toBe(404);
    expect(await downloadsOf(ana)).toEqual({});
  });

  it("removes the records of a deleted photo", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const photoId = await upload(ana, group.id, randomBytes(10));
    const kept = await upload(ana, group.id, randomBytes(10));
    await fetchZip(ana, group.id, [photoId, kept]);
    await fetchOriginal(bia, photoId);

    await json(api(`/api/photos/${photoId}`, { as: ana, method: "DELETE" }), 204);

    expect(Object.keys(await downloadsOf(ana))).toEqual([kept]);
    expect(await downloadsOf(bia)).toEqual({});
  });

  it("lists only what I have not downloaded, combined with the other filters", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const anaOld = await upload(ana, group.id, randomBytes(10));
    const anaNew = await upload(ana, group.id, randomBytes(10));
    const tagged = await upload(bia, group.id, randomBytes(10));
    await json(api(`/api/photos/${tagged}/tag`, { as: bia, method: "PUT", json: { value: "me" } }));
    await json(api(`/api/photos/${anaNew}/tag`, { as: bia, method: "PUT", json: { value: "me" } }));
    await fetchOriginal(bia, anaOld);
    await fetchOriginal(ana, anaNew);

    expect(await downloadedFlags(bia, group.id, "?downloaded=false")).toEqual([
      [tagged, false],
      [anaNew, false],
    ]);
    expect(await downloadedFlags(bia, group.id, "?filter=mine&downloaded=false")).toEqual([
      [tagged, false],
      [anaNew, false],
    ]);
    await fetchOriginal(bia, tagged);
    expect(await downloadedFlags(bia, group.id, "?filter=mine&downloaded=false")).toEqual([[anaNew, false]]);
    expect((await api(`/api/groups/${group.id}/photos?downloaded=true`, { as: bia })).status).toBe(400);
  });
});
