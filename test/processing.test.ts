import { describe, expect, it } from "vitest";
import { addSelfie, api, env, expectError, fakeFaceService, groupWith, json, photoRow, requestSlot, runCron, signup, storedKeys, upload, uploadScripted, waitFor, randomBytes } from "./helpers";

const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe("photo state machine", () => {
  it("counts the attempt at reservation and fails on the third", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    const photoId = await uploadScripted(ana, group.id, { status: 500 });

    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "recebida", attempts: 1 });
    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "recebida", attempts: 2 });
    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "falhou", attempts: 3 });
    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "falhou", attempts: 3 });

    const { group: seen } = await json(api(`/api/groups/${group.id}`, { as: ana }));
    expect(seen.counts).toEqual({ total: 1, processing: 0, failed: 1 });
    expect((await api(`/api/photos/${photoId}/original`, { as: ana })).status).toBe(200);
    const tagged = await json(api(`/api/photos/${photoId}/tag`, { as: ana, method: "PUT", json: { value: "me" } }));
    expect(tagged.photo).toMatchObject({ status: "falhou", mine: true, thumbUrl: null });

    await expectError(api(`/api/admin/photos/${photoId}/reprocess`, { as: ana, method: "POST" }), 403, "forbidden");
    await json(api(`/api/admin/photos/${photoId}/reprocess`, { as: admin, method: "POST" }), 204);
    expect(await photoRow(photoId)).toMatchObject({ status: "recebida", attempts: 0 });
  });

  it("spends no attempt while the face service is down, and resumes when it is back", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const photoId = await uploadScripted(ana, group.id, { faces: [1] });
    await fakeFaceService().setHealthy(false);

    await runCron();
    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "recebida", attempts: 0 });
    const { photos } = await json(api(`/api/groups/${group.id}/photos`, { as: ana }));
    expect(photos[0]).toMatchObject({ status: "recebida", thumbUrl: null });
    expect((await api(photos[0].originalUrl, { as: ana })).status).toBe(200);

    await fakeFaceService().setHealthy(true);
    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "processada", attempts: 1, width: 4000, height: 3000 });
  });

  it("gives the attempt back when the face service dies with the analysis in flight", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const photoId = await uploadScripted(ana, group.id, { faces: [1] });
    await fakeFaceService().crashNextAnalysis();

    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "recebida", attempts: 0 });
    expect((await photoRow(photoId)).error).toContain("face service unavailable");
    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "processada", attempts: 1 });
  });

  it("gives the attempt back on a 503 in the middle of the drain", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const photoIds = [];
    for (let index = 0; index < 4; index++) photoIds.push(await uploadScripted(ana, group.id, { status: 503 }));

    for (let run = 0; run < 4; run++) await runCron();

    const rows = await Promise.all(photoIds.map(photoRow));
    expect(rows.map((row) => [row.status, row.attempts])).toEqual(Array(4).fill(["recebida", 0]));
  });

  it("fails at once a photo the face service cannot read", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const unreadable = await uploadScripted(ana, group.id, { status: 422 });
    const fine = await uploadScripted(ana, group.id, { faces: [1] });

    await runCron();

    expect(await photoRow(unreadable)).toMatchObject({ status: "falhou", attempts: 1 });
    expect(await photoRow(fine)).toMatchObject({ status: "processada", attempts: 1 });
    expect(await storedKeys()).toHaveLength(4);
  });

  it("leaves no object in R2 when the photo is deleted while being processed", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const photoId = await uploadScripted(ana, group.id, { faces: [1], delayMs: 300 });

    const cron = runCron();
    await waitFor(async () => (await photoRow(photoId)).status === "processando");
    await json(api(`/api/photos/${photoId}`, { as: ana, method: "DELETE" }), 204);
    await cron;

    expect(await storedKeys()).toEqual([]);
    expect(await count("faces")).toBe(0);
    expect((await photoRow(photoId)).deleted_at).not.toBeNull();
  });

  it("keeps the derivatives when a slow attempt ends after the attempt that replaced it", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const photoId = await uploadScripted(ana, group.id, { faces: [1] });
    await fakeFaceService().delayNextAnalysis(500);

    const slow = runCron();
    await waitFor(async () => (await photoRow(photoId)).status === "processando");
    await env.DB.prepare("UPDATE photos SET status = 'recebida', status_at = ?2 WHERE id = ?1").bind(photoId, new Date().toISOString()).run();
    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "processada", attempts: 2 });
    await slow;

    expect((await api(`/api/photos/${photoId}/thumb`, { as: ana })).status).toBe(200);
    expect((await api(`/api/photos/${photoId}/preview`, { as: ana })).status).toBe(200);
    expect(await storedKeys()).toHaveLength(3);
  });

  it("replaces faces and scores when a photo is processed again", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    await json(addSelfie(ana, { faces: [1] }));
    const photoId = await uploadScripted(ana, group.id, { faces: [1, 2] });
    await runCron();
    expect([await count("faces"), await count("scores")]).toEqual([2, 1]);

    await json(api(`/api/admin/photos/${photoId}/reprocess`, { as: admin, method: "POST" }), 204);
    expect(await count("scores")).toBe(0);
    await runCron();

    expect([await count("faces"), await count("scores")]).toEqual([2, 1]);
    expect(await storedKeys()).toHaveLength(4);
  });

  it("processes a backlog larger than the fixed parallelism", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    for (let index = 0; index < 5; index++) await uploadScripted(ana, group.id, { faces: [index] });
    await runCron();
    const { group: seen } = await json(api(`/api/groups/${group.id}`, { as: ana }));
    expect(seen.counts).toEqual({ total: 5, processing: 0, failed: 0 });
    expect(await count("faces")).toBe(5);
  });
});

describe("what the cron does when nothing else happens", () => {
  it("removes an upload abandoned for over an hour, row and partial object", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const { photo } = await json(requestSlot(ana, group.id, 500));
    const fresh = await json(requestSlot(ana, group.id, 500));
    await env.BUCKET.put(`g/${group.id}/${photo.id}/original`, "partial");
    await env.DB.prepare("UPDATE photos SET status_at = ?2 WHERE id = ?1").bind(photo.id, new Date(Date.now() - 61 * 60_000).toISOString()).run();

    await runCron();

    expect(await storedKeys()).toEqual([]);
    expect(await env.DB.prepare("SELECT id FROM photos").all()).toMatchObject({ results: [{ id: fresh.photo.id }] });
    expect((await json(api(`/api/groups/${group.id}`, { as: ana }))).group.usedBytes).toBe(500);
  });

  it("returns a photo stuck in processing for over five minutes, keeping the counted attempt", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const photoId = await upload(ana, group.id, randomBytes(100));
    await fakeFaceService().setHealthy(false);
    await env.DB.prepare("UPDATE photos SET status = 'processando', attempts = 1, status_at = ?2 WHERE id = ?1")
      .bind(photoId, new Date(Date.now() - 6 * 60_000).toISOString())
      .run();

    await runCron();
    expect(await photoRow(photoId)).toMatchObject({ status: "recebida", attempts: 1 });
  });

  it("deletes expired sessions", async () => {
    const ana = await signup("Ana");
    await env.DB.prepare("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'").run();
    await expectError(api("/api/me", { as: ana }), 401, "unauthorized");
    await runCron();
    expect(await count("sessions")).toBe(0);
  });
});
