import { describe, expect, it } from "vitest";
import { removeSelfie } from "../src/worker/selfies";
import { addSelfie, api, env, groupWith, join, json, myPhotoIds, photoRow, runCron, signup, uploadScripted, waitFor } from "./helpers";

const tag = (user: any, photoId: string, value: "me" | "not_me" | null) =>
  json(api(`/api/photos/${photoId}/tag`, { as: user, method: "PUT", json: { value } }));

/** A D1 that dies when asked for a statement matching `pattern`, like a request cancelled at that point. */
function dyingAt(db: D1Database, pattern: RegExp): D1Database {
  return new Proxy(db, {
    get(target, key) {
      if (key !== "prepare") return Reflect.get(target, key);
      return (sql: string) => {
        if (pattern.test(sql)) throw new Error("request cancelled");
        return target.prepare(sql);
      };
    },
  });
}

describe("A2 and A4: each one gets the photos they appear in", () => {
  it("puts solo and group photos on the page of who is in them, including who joins later", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    await json(addSelfie(ana, { faces: [1] }));
    const solo = await uploadScripted(bia, group.id, { faces: [1] });
    const together = await uploadScripted(bia, group.id, { faces: [2, 1, 3] });
    const landscape = await uploadScripted(bia, group.id, { faces: [] });
    await runCron();

    expect(await myPhotoIds(ana)).toEqual([together, solo]);
    expect(await myPhotoIds(bia)).toEqual([]);

    await json(addSelfie(bia, { faces: [2] }));
    expect(await myPhotoIds(bia)).toEqual([together]);

    const caio = await signup("Caio");
    await json(addSelfie(caio, { faces: [3] }));
    expect(await myPhotoIds(caio)).toEqual([]);
    await join(caio, group);
    expect(await myPhotoIds(caio)).toEqual([together]);

    const page = await json(api(`/api/groups/${group.id}/photos?filter=mine`, { as: ana }));
    expect(page.photos.map((photo: any) => [photo.id, photo.mine])).toEqual([[together, true], [solo, true]]);
    const ofBia = await json(api(`/api/groups/${group.id}/photos?filter=user:${bia.id}`, { as: ana }));
    expect(ofBia.photos.map((photo: any) => [photo.id, photo.mine])).toEqual([[together, true]]);
    const all = await json(api(`/api/groups/${group.id}/photos`, { as: caio }));
    expect(all.photos.map((photo: any) => [photo.id, photo.mine])).toEqual([[landscape, false], [together, true], [solo, false]]);
    expect((await json(api("/api/groups", { as: ana }))).groups[0]).toMatchObject({ photoCount: 3, myPhotoCount: 2 });
  });

  it("does not lose the pair when someone joins while the photo is being processed", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const caio = await signup("Caio");
    await json(addSelfie(caio, { faces: [7] }));
    const photoId = await uploadScripted(ana, group.id, { faces: [7], delayMs: 300 });

    const cron = runCron();
    await waitFor(async () => (await photoRow(photoId)).status === "processando");
    await join(caio, group);
    expect(await myPhotoIds(caio)).toEqual([]);
    await cron;

    expect(await myPhotoIds(caio)).toEqual([photoId]);
  });

  it("refills a score that a dead rescore left missing", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    await json(addSelfie(ana, { faces: [1] }));
    const photoId = await uploadScripted(ana, group.id, { faces: [1] });
    await runCron();
    await env.DB.prepare("DELETE FROM scores").run();
    expect(await myPhotoIds(ana)).toEqual([]);

    await runCron();
    expect(await myPhotoIds(ana)).toEqual([photoId]);
  });

  it("judges by the threshold at reading time, with no recalculation", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    await json(addSelfie(ana, { faces: [1] }));
    const halfAlike = await uploadScripted(ana, group.id, { faces: [[1, 2]] });
    await runCron();
    const { score } = (await env.DB.prepare("SELECT score FROM scores WHERE user_id = ?1").bind(ana.id).first<{ score: number }>())!;
    expect(score).toBeCloseTo(Math.SQRT1_2, 5);
    expect(await myPhotoIds(ana)).toEqual([halfAlike]);

    await json(api("/api/admin/settings", { as: admin, method: "PATCH", json: { matchThreshold: 0.8 } }));
    expect(await myPhotoIds(ana)).toEqual([]);
  });

  it("counts a score exactly at the threshold as a match", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    await json(addSelfie(ana, { faces: [1] }));
    const photoId = await uploadScripted(ana, group.id, { faces: [1] });
    await runCron();
    const { score } = (await env.DB.prepare("SELECT score FROM scores WHERE user_id = ?1").bind(ana.id).first<{ score: number }>())!;
    expect(score).toBe(1);

    await json(api("/api/admin/settings", { as: admin, method: "PATCH", json: { matchThreshold: 1 } }));
    expect(await myPhotoIds(ana)).toEqual([photoId]);
  });

  it("leaves no stale score when a rescore dies right after erasing, and the cron resumes it", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const { selfie: first } = await json(addSelfie(ana, { faces: [1] }));
    await json(addSelfie(ana, { faces: [2] }));
    const onlyFirst = await uploadScripted(ana, group.id, { faces: [1] });
    const onlySecond = await uploadScripted(ana, group.id, { faces: [2] });
    await runCron();
    expect((await myPhotoIds(ana)).sort()).toEqual([onlyFirst, onlySecond].sort());

    const dying = { ...env, DB: dyingAt(env.DB, /SELECT p\.id FROM photos p/) };
    await expect(removeSelfie(dying, ana.id, first.id)).rejects.toThrow("request cancelled");
    expect(await myPhotoIds(ana)).toEqual([]);

    await runCron();
    expect(await myPhotoIds(ana)).toEqual([onlySecond]);
  });

  it("drops the matches of a removed selfie", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const { selfie } = await json(addSelfie(ana, { faces: [1] }));
    const photoId = await uploadScripted(ana, group.id, { faces: [1] });
    await runCron();
    expect(await myPhotoIds(ana)).toEqual([photoId]);

    await json(api(`/api/me/selfies/${selfie.id}`, { as: ana, method: "DELETE" }), 204);
    expect(await myPhotoIds(ana)).toEqual([]);
  });
});

describe("A5: the manual tag prevails over the score", () => {
  it("removes a wrong match and adds a missed one with one tag each", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    await json(addSelfie(ana, { faces: [1] }));
    const matched = await uploadScripted(ana, group.id, { faces: [1] });
    const missed = await uploadScripted(ana, group.id, { faces: [9] });
    await runCron();
    expect(await myPhotoIds(ana)).toEqual([matched]);

    expect((await tag(ana, matched, "not_me")).photo).toMatchObject({ mine: false, myTag: "not_me" });
    expect((await tag(ana, missed, "me")).photo).toMatchObject({ mine: true, myTag: "me" });
    expect(await myPhotoIds(ana)).toEqual([missed]);

    await json(api(`/api/admin/photos/${matched}/reprocess`, { as: (await groupAdmin()), method: "POST" }), 204);
    await runCron();
    expect(await myPhotoIds(ana), "the tag survives a new score").toEqual([missed]);

    expect((await tag(ana, matched, null)).photo).toMatchObject({ mine: true, myTag: null });
    expect((await tag(ana, missed, null)).photo).toMatchObject({ mine: false, myTag: null });
  });
});

async function groupAdmin() {
  const response = await api("/api/auth/login", { json: { email: "admin@example.com", password: "correct horse battery" } });
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const { user } = await json(response);
  return { cookie, id: user.id, email: user.email };
}
