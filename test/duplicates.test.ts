import { describe, expect, it } from "vitest";
import {
  api,
  createGroup,
  env,
  expectError,
  groupWith,
  join,
  json,
  photoRow,
  putOriginal,
  randomBytes,
  requestSlot,
  runCron,
  storedKeys,
  upload,
  type Session,
} from "./helpers";

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestHashedSlot(user: Session, groupId: string, bytes: Uint8Array<ArrayBuffer>, contentHash?: string) {
  const json = { filename: "foto.jpg", contentType: "image/jpeg", sizeBytes: bytes.length, contentHash: contentHash ?? (await sha256Hex(bytes)) };
  return api(`/api/groups/${groupId}/photos`, { as: user, json });
}

async function photoIds(): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT id FROM photos ORDER BY created_at").all<{ id: string }>();
  return results.map((row) => row.id);
}

async function usage(admin: Session, groupId: string, user: Session) {
  const overview = await json(api("/api/admin/overview", { as: admin }));
  return {
    group: overview.groups.find((group: { id: string }) => group.id === groupId).usedBytes,
    month: overview.users.find((other: { id: string }) => other.id === user.id).monthUsedBytes,
  };
}

describe("a photo already in the group is not sent again", () => {
  it("answers the slot request with the photo already there, from another person, reserving nothing", async () => {
    const { admin, group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const bytes = randomBytes(1000);
    const first = await upload(ana, group.id, bytes);
    expect((await photoRow(first)).content_hash).toBe(await sha256Hex(bytes));

    expect(await json(requestHashedSlot(bia, group.id, bytes))).toEqual({ duplicate: true, photoId: first });
    expect(await photoIds()).toEqual([first]);
    expect(await usage(admin, group.id, bia)).toEqual({ group: 1000, month: 0 });
  });

  it("refuses bytes that are not the ones declared, and gives the slot back", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    const declared = randomBytes(1000);
    const { photo } = await json(requestHashedSlot(ana, group.id, declared));

    await expectError(putOriginal(ana, photo.id, randomBytes(1000)), 400, "hash_mismatch");
    expect(await photoIds()).toEqual([]);
    expect(await storedKeys()).toEqual([]);
    expect(await usage(admin, group.id, ana)).toEqual({ group: 0, month: 0 });
  });

  it("discards, on arrival, the second of two slots with the same bytes and keeps the first", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    const bytes = randomBytes(1000);
    const first = (await json(requestHashedSlot(ana, group.id, bytes))).photo.id;
    const second = (await json(requestHashedSlot(ana, group.id, bytes))).photo.id;

    expect((await json(putOriginal(ana, first, bytes))).photo).toMatchObject({ id: first, status: "recebida" });
    expect(await json(putOriginal(ana, second, bytes))).toEqual({ duplicate: true, photoId: first });

    expect(await photoIds()).toEqual([first]);
    expect(await storedKeys()).toEqual([`g/${group.id}/${first}/original`]);
    expect(await usage(admin, group.id, ana)).toEqual({ group: 1000, month: 1000 });
  });

  it("finds the duplicate on arrival when the page could not declare a hash", async () => {
    const { admin, group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const bytes = randomBytes(1000);
    const first = await upload(ana, group.id, bytes);

    const { photo } = await json(requestSlot(bia, group.id, bytes.length));
    expect(await json(putOriginal(bia, photo.id, bytes))).toEqual({ duplicate: true, photoId: first });
    expect(await photoIds()).toEqual([first]);
    expect(await storedKeys()).toEqual([`g/${group.id}/${first}/original`]);
    expect(await usage(admin, group.id, bia)).toEqual({ group: 1000, month: 0 });
  });

  it("keeps exactly one of two equal uploads sent at the same time", async () => {
    const { admin, group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const bytes = randomBytes(5000);
    const slotA = (await json(requestHashedSlot(ana, group.id, bytes))).photo.id;
    const slotB = (await json(requestHashedSlot(bia, group.id, bytes))).photo.id;

    const answers = await Promise.all([json(putOriginal(ana, slotA, bytes)), json(putOriginal(bia, slotB, bytes))]);
    const kept = answers.find((answer) => answer.photo)!.photo.id;
    expect(answers.filter((answer) => answer.duplicate)).toEqual([{ duplicate: true, photoId: kept }]);

    expect(await photoIds()).toEqual([kept]);
    expect(await storedKeys()).toEqual([`g/${group.id}/${kept}/original`]);
    const overview = await json(api("/api/admin/overview", { as: admin }));
    expect(overview.groups[0].usedBytes).toBe(5000);
    expect(overview.users.reduce((total: number, user: { monthUsedBytes: number }) => total + user.monthUsedBytes, 0)).toBe(5000);
  });

  it("accepts again the bytes of a deleted photo", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const bytes = randomBytes(1000);
    const first = await upload(ana, group.id, bytes);
    await json(api(`/api/photos/${first}`, { as: ana, method: "DELETE" }), 204);

    const { photo } = await json(requestHashedSlot(ana, group.id, bytes));
    expect((await json(putOriginal(ana, photo.id, bytes))).photo).toMatchObject({ id: photo.id, status: "recebida" });
  });

  it("does not take the same bytes in another group as a duplicate", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    const other = await createGroup(admin, "Outra");
    await join(ana, other);
    const bytes = randomBytes(1000);
    await upload(ana, group.id, bytes);

    const { photo } = await json(requestHashedSlot(ana, other.id, bytes));
    expect((await json(putOriginal(ana, photo.id, bytes))).photo).toMatchObject({ id: photo.id, groupId: other.id });
  });

  it("finds a photo sent before hashes existed once the cron has filled its hash", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const bytes = randomBytes(1000);
    const old = await upload(ana, group.id, bytes);
    await env.DB.prepare("UPDATE photos SET content_hash = NULL WHERE id = ?1").bind(old).run();
    expect(await json(requestHashedSlot(bia, group.id, bytes))).toMatchObject({ photo: { id: expect.any(String) } });

    await runCron();
    expect((await photoRow(old)).content_hash).toBe(await sha256Hex(bytes));
    expect(await json(requestHashedSlot(bia, group.id, bytes))).toEqual({ duplicate: true, photoId: old });
  });
});
