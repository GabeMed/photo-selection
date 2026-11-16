import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, env, expectError, groupWith, json, photoRow, randomBytes, signup, storedKeys, type Session } from "./helpers";

async function uploadLink(user: Session, groupId: string, rotate?: boolean): Promise<string> {
  const init = rotate === undefined ? { as: user, method: "POST" } : { as: user, json: { rotate } };
  return (await json(api(`/api/groups/${groupId}/upload-link`, init))).uploadLink;
}

/** The path of the link, sent without any cookie, as the Shortcut does. */
function sendThroughLink(link: string, bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) {
  const path = new URL(link).pathname;
  return api(path, { body: bytes, headers: { "content-length": String(bytes.length), ...headers } });
}

function withHead(head: number[] | string, length = 1000): Uint8Array<ArrayBuffer> {
  const bytes = randomBytes(length);
  bytes.set(typeof head === "string" ? new TextEncoder().encode(head) : head);
  return bytes;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];

describe("upload link", () => {
  it("is created once, shown again the same, and replaced on rotate", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const first = await uploadLink(ana, group.id);
    expect(first).toMatch(/^https:\/\/photos\.test\/api\/u\/[A-Za-z0-9_-]{43}$/);
    expect(await uploadLink(ana, group.id)).toBe(first);
    expect(await uploadLink(ana, group.id, false)).toBe(first);
    expect(await uploadLink(bia, group.id)).not.toBe(first);

    const rotated = await uploadLink(ana, group.id, true);
    expect(rotated).not.toBe(first);
    expect(await uploadLink(ana, group.id)).toBe(rotated);
    await expectError(sendThroughLink(first, withHead(JPEG)), 404, "not_found");
    await json(sendThroughLink(rotated, withHead(JPEG)));
  });

  it("is only given to members of the group", async () => {
    const { group } = await groupWith("Ana");
    const outsider = await signup("Caio");
    await expectError(api(`/api/groups/${group.id}/upload-link`, { as: outsider, method: "POST" }), 404, "not_found");
    await expectError(api(`/api/groups/${group.id}/upload-link`, { method: "POST" }), 401, "unauthorized");
  });
});

describe("upload through the link", () => {
  it("stores the same bytes as a photo of that person, in the normal pipeline, without a session", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const bytes = withHead(JPEG, 2000);
    const sent = await json(sendThroughLink(await uploadLink(ana, group.id), bytes, { "content-type": "image/jpeg", "x-filename": "../IMG_0001.JPG" }));
    expect(sent).toEqual({ ok: true, photoId: expect.any(String) });

    expect(await photoRow(sent.photoId)).toMatchObject({
      group_id: group.id,
      uploader_id: ana.id,
      filename: "IMG_0001.JPG",
      content_type: "image/jpeg",
      size_bytes: bytes.length,
      status: "recebida",
    });
    const original = await api(`/api/photos/${sent.photoId}/original`, { as: bia });
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(bytes);
  });

  it("finds the type in the first bytes when the Shortcut sends octet-stream, and names the file", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const link = await uploadLink(ana, group.id);
    const cases: [Uint8Array<ArrayBuffer>, string, RegExp][] = [
      [withHead(JPEG, 70_000), "image/jpeg", /^foto-\d{8}-\d{6}-[0-9a-f]{4}\.jpg$/],
      [withHead([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png", /\.png$/],
      [withHead("\0\0\0\x18ftypheic"), "image/heic", /\.heic$/],
      [withHead("\0\0\0\x18ftypmif1"), "image/heif", /\.heif$/],
      [withHead("RIFF\0\0\0\0WEBP"), "image/webp", /\.webp$/],
    ];
    for (const [bytes, contentType, filename] of cases) {
      const { photoId } = await json(sendThroughLink(link, bytes, { "content-type": "application/octet-stream" }));
      const row = await photoRow(photoId);
      expect(row.content_type).toBe(contentType);
      expect(row.filename).toMatch(filename);
      const original = await api(`/api/photos/${photoId}/original`, { as: ana });
      expect(new Uint8Array(await original.arrayBuffer())).toEqual(bytes);
    }
  });

  it("refuses what is not an accepted image, an unknown token and a body without length", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const link = await uploadLink(ana, group.id);
    await expectError(sendThroughLink(link, withHead("\0\0\0\x18ftypqt  "), { "content-type": "video/quicktime" }), 415, "unsupported_type");
    await expectError(sendThroughLink(link, withHead("hello"), { "content-type": "application/octet-stream" }), 415, "unsupported_type");
    await expectError(sendThroughLink("https://photos.test/api/u/unknown", withHead(JPEG)), 404, "not_found");

    const bytes = withHead(JPEG);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const unsized = await exports.default.fetch(new Request(link, { method: "POST", body: stream }));
    await expectError(unsized, 411, "length_required");
    expect(await storedKeys()).toEqual([]);
  });

  it("obeys the same quotas as the page and keeps no slot after a refusal", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    await json(api(`/api/admin/groups/${group.id}`, { as: admin, method: "PATCH", json: { quotaBytes: 1500 } }));
    const link = await uploadLink(ana, group.id);
    await json(sendThroughLink(link, withHead(JPEG, 1000)));

    const message = await expectError(sendThroughLink(link, withHead(JPEG, 501)), 409, "group_quota_exceeded");
    expect(message).toContain("usados de");
    await json(api("/api/admin/settings", { as: admin, method: "PATCH", json: { userMonthlyQuotaBytes: 1200 } }));
    await expectError(sendThroughLink(link, withHead(JPEG, 300)), 409, "user_quota_exceeded");

    const { results } = await env.DB.prepare("SELECT status FROM photos").all();
    expect(results).toEqual([{ status: "recebida" }]);
  });

  it("names the photo itself when the filename header comes empty", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const sent = await json(sendThroughLink(await uploadLink(ana, group.id), withHead(JPEG), { "content-type": "image/jpeg", "x-filename": " " }));
    expect((await photoRow(sent.photoId)).filename).toMatch(/^foto-\d{8}-\d{6}-[0-9a-f]{4}\.jpg$/);
  });

  it("gives the reserved space back when the bytes do not arrive as declared", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const link = await uploadLink(ana, group.id);
    const mismatched = api(new URL(link).pathname, {
      body: withHead(JPEG, 1000),
      headers: { "content-length": "999", "content-type": "image/jpeg" },
    });
    await expectError(mismatched, 400, "size_mismatch");
    const { results } = await env.DB.prepare("SELECT id FROM photos").all();
    expect(results).toEqual([]);
    expect(await storedKeys()).toEqual([]);
  });
});
