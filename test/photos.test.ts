import { describe, expect, it } from "vitest";
import { uniqueNames } from "../src/worker/zip";
import { api, env, expectError, groupWith, json, putOriginal, randomBytes, requestSlot, runCron, signup, storedKeys, upload, uploadScripted } from "./helpers";

async function bodyBytes(response: Response | Promise<Response>): Promise<Uint8Array> {
  const settled = await response;
  expect(settled.status).toBe(200);
  return new Uint8Array(await settled.arrayBuffer());
}

/** Reads the entries of a stored (uncompressed) ZIP from its central directory. */
function unzipStored(zip: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const entries = new Map<string, Uint8Array>();
  let cursor = view.getUint32(end + 16, true);
  for (let index = 0; index < view.getUint16(end + 10, true); index++) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    expect(view.getUint16(cursor + 10, true), "compression method").toBe(0);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    entries.set(name, zip.subarray(dataStart, dataStart + size));
    cursor += 46 + nameLength;
  }
  return entries;
}

describe("A3: the stored file is the received file", () => {
  it("downloads bytes identical to a random binary upload, before and after processing", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const bytes = randomBytes(300_000);
    const photoId = await upload(ana, group.id, bytes, 'férias "1".heic');

    const early = await api(`/api/photos/${photoId}/original`, { as: bia });
    expect(early.headers.get("content-disposition")).toBe(
      `attachment; filename="f_rias _1_.heic"; filename*=UTF-8''f%C3%A9rias%20%221%22.heic`,
    );
    expect(early.headers.get("content-type")).toBe("image/jpeg");
    expect(await bodyBytes(early)).toEqual(bytes);

    await runCron();
    expect(await bodyBytes(api(`/api/photos/${photoId}/original`, { as: bia }))).toEqual(bytes);
    expect(new TextDecoder().decode(await bodyBytes(api(`/api/photos/${photoId}/thumb`, { as: bia })))).toBe("thumb");
  });

  it("accepts the bytes only once, and only with the declared size", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    await expectError(requestSlot(ana, group.id, 10, "clip.mov", "video/quicktime"), 415, "unsupported_type");

    const { photo, uploadUrl } = await json(requestSlot(ana, group.id, 1000));
    expect(uploadUrl).toBe(`/api/photos/${photo.id}/original`);
    await expectError(putOriginal(ana, photo.id, randomBytes(999)), 400, "size_mismatch");
    await expectError(putOriginal(bia, photo.id, randomBytes(1000)), 403, "forbidden");
    await expectError(api(`/api/photos/${photo.id}/original`, { as: ana }), 404, "not_found");

    const stored = await json(putOriginal(ana, photo.id, randomBytes(1000)));
    expect(stored.photo).toMatchObject({ id: photo.id, status: "recebida", thumbUrl: null, previewUrl: null, sizeBytes: 1000, canDelete: true });
    await expectError(putOriginal(ana, photo.id, randomBytes(1000)), 409, "not_uploading");
  });

  it("streams a ZIP without compression holding the selected originals", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const files = [randomBytes(70_000), randomBytes(1), randomBytes(150_000)];
    const ids = [];
    for (const file of files) ids.push(await upload(ana, group.id, file, "IMG_0001.heic"));
    const skipped = await upload(ana, group.id, randomBytes(10), "other.jpg");

    const response = await api(`/api/groups/${group.id}/download`, { as: bia, json: { photoIds: ids } });
    expect(response.headers.get("content-type")).toBe("application/zip");
    const entries = unzipStored(await bodyBytes(response));
    expect([...entries.keys()]).toEqual(["IMG_0001.heic", "IMG_0001 (2).heic", "IMG_0001 (3).heic"]);
    expect([...entries.values()]).toEqual(files);

    await expectError(api(`/api/groups/${group.id}/download`, { as: bia, json: { photoIds: [skipped, "missing"] } }), 404, "not_found");
    await expectError(api(`/api/groups/${group.id}/download`, { as: bia, json: { photoIds: [] } }), 400, "invalid_request");
  });

  it("stores only the clean last segment of the file name, for the header and the ZIP alike", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const climbing = await upload(ana, group.id, randomBytes(10), "../../x.jpg");
    const windows = await upload(ana, group.id, randomBytes(10), "C:\\fotos\\a\\b\u0007.jpg");

    const { photos } = await json(api(`/api/groups/${group.id}/photos`, { as: ana }));
    expect(photos.map((photo: any) => photo.filename).sort()).toEqual(["b_.jpg", "x.jpg"]);
    const original = await api(`/api/photos/${climbing}/original`, { as: ana });
    expect(original.headers.get("content-disposition")).toBe(`attachment; filename="x.jpg"; filename*=UTF-8''x.jpg`);
    const zip = await bodyBytes(api(`/api/groups/${group.id}/download`, { as: ana, json: { photoIds: [climbing, windows] } }));
    expect([...unzipStored(zip).keys()].sort()).toEqual(["b_.jpg", "x.jpg"]);

    for (const filename of ["", "fotos/", "a/..", 7, "a".repeat(256)]) {
      const slot = api(`/api/groups/${group.id}/photos`, { as: ana, json: { filename, contentType: "image/jpeg", sizeBytes: 10 } });
      await expectError(slot, 400, "invalid_request");
    }
  });

  it("suffixes repeated names before the extension", () => {
    expect(uniqueNames(["a.jpg", "A.JPG", "a (2).jpg", "noext", "noext"])).toEqual(["a.jpg", "A (2).JPG", "a (2) (2).jpg", "noext", "noext (2)"]);
  });
});

describe("group page", () => {
  it("shows every photo to the members, newest first, in pages", async () => {
    const { group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const first = await upload(ana, group.id, randomBytes(10), "1.jpg");
    const second = await upload(bia, group.id, randomBytes(10), "2.jpg");
    await json(requestSlot(ana, group.id, 10));

    const { photos, nextCursor } = await json(api(`/api/groups/${group.id}/photos`, { as: bia }));
    expect(nextCursor).toBeNull();
    expect(photos.map((photo: any) => [photo.id, photo.uploaderName, photo.canDelete])).toEqual([
      [second, "Bia", true],
      [first, "Ana", false],
    ]);
    await expectError(api(`/api/groups/${group.id}/photos?cursor=garbage`, { as: bia }), 400, "invalid_request");
  });

  it("pages through more photos than one page holds, without repeating or skipping any", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    // Three photos share each instant, so the page boundary also falls inside a tie.
    const rows = Array.from({ length: 205 }, (_, index) => ({
      id: crypto.randomUUID(),
      createdAt: new Date(Date.UTC(2026, 0, 1) + Math.floor(index / 3) * 1000).toISOString(),
    }));
    const insert = env.DB.prepare(
      `INSERT INTO photos (id, group_id, uploader_id, filename, content_type, size_bytes, status, created_at, status_at)
       VALUES (?1, ?2, ?3, 'a.jpg', 'image/jpeg', 1, 'recebida', ?4, ?4)`,
    );
    await env.DB.batch(rows.map((row) => insert.bind(row.id, group.id, ana.id, row.createdAt)));
    const newestFirst = rows.map((row) => row.createdAt + row.id).sort().reverse().map((key) => key.slice(24));

    const pages: string[][] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const page = await json(api(`/api/groups/${group.id}/photos${query}`, { as: ana }));
      pages.push(page.photos.map((photo: any) => photo.id));
      cursor = page.nextCursor;
    } while (cursor && pages.length < 5);

    expect(pages.map((page) => page.length)).toEqual([100, 100, 5]);
    expect(pages.flat()).toEqual(newestFirst);
  });

  it("lets the uploader or the admin delete, for good", async () => {
    const { admin, group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    const mine = await uploadScripted(ana, group.id, { faces: [1] });
    const other = await uploadScripted(ana, group.id, { faces: [1] });
    await runCron();
    await json(api(`/api/photos/${mine}/tag`, { as: bia, method: "PUT", json: { value: "me" } }));
    const usedBefore = (await json(api(`/api/groups/${group.id}`, { as: ana }))).group.usedBytes;

    await expectError(api(`/api/photos/${mine}`, { as: bia, method: "DELETE" }), 403, "forbidden");
    await json(api(`/api/photos/${mine}`, { as: ana, method: "DELETE" }), 204);
    await json(api(`/api/photos/${other}`, { as: admin, method: "DELETE" }), 204);

    await expectError(api(`/api/photos/${mine}/original`, { as: ana }), 404, "not_found");
    expect(await storedKeys()).toEqual([]);
    const after = (await json(api(`/api/groups/${group.id}`, { as: ana }))).group;
    expect(usedBefore).toBeGreaterThan(0);
    expect(after).toMatchObject({ usedBytes: 0, counts: { total: 0, processing: 0, failed: 0 } });
  });
});

describe("A7: a non-member sees nothing, even holding the address", () => {
  it("answers 404 on thumb, preview, original, tag, ZIP and the group itself", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const photoId = await uploadScripted(ana, group.id, { faces: [1] });
    await runCron();
    const outsider = await signup("Eva");

    const attempts = [
      api(`/api/photos/${photoId}/thumb`, { as: outsider }),
      api(`/api/photos/${photoId}/preview`, { as: outsider }),
      api(`/api/photos/${photoId}/original`, { as: outsider }),
      api(`/api/photos/${photoId}/tag`, { as: outsider, method: "PUT", json: { value: "me" } }),
      api(`/api/photos/${photoId}`, { as: outsider, method: "DELETE" }),
      api(`/api/groups/${group.id}/download`, { as: outsider, json: { photoIds: [photoId] } }),
      api(`/api/groups/${group.id}/photos`, { as: outsider }),
      api(`/api/groups/${group.id}/photos`, { as: outsider, json: { filename: "a.jpg", contentType: "image/jpeg", sizeBytes: 1 } }),
      api(`/api/groups/${group.id}`, { as: outsider }),
    ];
    for (const attempt of attempts) await expectError(attempt, 404, "not_found");
    await expectError(api(`/api/photos/${photoId}/original`), 401, "unauthorized");
    expect((await json(api("/api/groups", { as: outsider }))).groups).toEqual([]);
    expect((await api(`/api/photos/${photoId}/thumb`, { as: ana })).status).toBe(200);
  });
});
