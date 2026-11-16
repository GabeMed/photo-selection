import { Hono } from "hono";
import { changedRows, isoBefore, newId, nowIso } from "./db";
import type { Analysis } from "./face-service";
import { LISTED_PHOTO, loadPhotoFor, requireMember, type PhotoRow, type PhotoStatus } from "./groups";
import { ApiError, invalidRequest, notFound, readJsonObject, readPositiveInteger, readText, type AppEnv, type User } from "./http";
import { appearsIn } from "./matching";
import { reservePhotoSlot } from "./quota";
import { zipStream } from "./zip";

export const MAX_ATTEMPTS = 3;
const UPLOAD_TIMEOUT_MS = 60 * 60_000;
const PROCESSING_TIMEOUT_MS = 5 * 60_000;
const PAGE_SIZE = 100;
const MAX_FILENAME_LENGTH = 255;
// The ZIP is written without ZIP64 records, which caps the archive at 4 GiB.
const MAX_ZIP_BYTES = 4 * 1024 ** 3 - 64 * 1024 ** 2;
const MAX_ZIP_ENTRIES = 1000;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/heic", "image/heif", "image/png", "image/webp"]);
const DERIVED_CACHE = "private, max-age=31536000, immutable";

interface PhotoLocation {
  id: string;
  group_id: string;
}

export function photoKeys(photo: PhotoLocation) {
  const prefix = `g/${photo.group_id}/${photo.id}`;
  return { original: `${prefix}/original`, preview: `${prefix}/preview.jpg`, thumb: `${prefix}/thumb.jpg` };
}

// ---- State transitions: every one is conditional on the state it read. ----

async function markReceived(db: D1Database, photo: PhotoRow): Promise<boolean> {
  const updated = await db
    .prepare("UPDATE photos SET status = 'recebida', status_at = ?2 WHERE id = ?1 AND status = 'enviando' AND status_at = ?3")
    .bind(photo.id, nowIso(), photo.status_at)
    .run();
  return changedRows(updated) === 1;
}

export interface ReservedPhoto extends PhotoLocation {
  status_at: string;
}

const RESERVABLE = `status = 'recebida' AND attempts < ${MAX_ATTEMPTS} AND deleted_at IS NULL`;

export async function hasReservablePhoto(db: D1Database): Promise<boolean> {
  return (await db.prepare(`SELECT 1 FROM photos WHERE ${RESERVABLE} LIMIT 1`).first()) !== null;
}

/**
 * Reserves the oldest waiting photo and counts the attempt in the same statement.
 * `excludedIds` keeps a photo that already failed in this drain out of the same drain.
 */
export async function reserveNextPhoto(db: D1Database, excludedIds: string[]): Promise<ReservedPhoto | null> {
  return db
    .prepare(
      `UPDATE photos SET status = 'processando', attempts = attempts + 1, status_at = ?1
       WHERE id = (SELECT id FROM photos WHERE ${RESERVABLE} AND id NOT IN (SELECT value FROM json_each(?2))
                   ORDER BY status_at LIMIT 1)
         AND ${RESERVABLE}
       RETURNING id, group_id, status_at`,
    )
    .bind(nowIso(), JSON.stringify(excludedIds))
    .first<ReservedPhoto>();
}

/** Marks the photo processed and replaces its faces in one batch; false means the reservation was lost. */
export async function completeProcessing(db: D1Database, reserved: ReservedPhoto, analysis: Analysis): Promise<boolean> {
  const completedAt = nowIso();
  const completedNow = "EXISTS (SELECT 1 FROM photos WHERE id = ?1 AND status = 'processada' AND status_at = ?2)";
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE photos SET status = 'processada', status_at = ?2, error = NULL,
                width = ?4, height = ?5, preview_bytes = ?6, thumb_bytes = ?7
         WHERE id = ?1 AND status = 'processando' AND status_at = ?3 AND deleted_at IS NULL`,
      )
      .bind(reserved.id, completedAt, reserved.status_at, analysis.width, analysis.height, analysis.preview.length, analysis.thumb.length),
    db.prepare(`DELETE FROM faces WHERE photo_id = ?1 AND ${completedNow}`).bind(reserved.id, completedAt),
    ...analysis.faces.map((face) =>
      db
        .prepare(
          `INSERT INTO faces (id, photo_id, group_id, box, det_score, embedding)
           SELECT ?3, ?1, ?4, ?5, ?6, ?7 WHERE ${completedNow}`,
        )
        .bind(reserved.id, completedAt, newId(), reserved.group_id, JSON.stringify(face.box), face.detScore, face.embedding),
    ),
  ]);
  return changedRows(updated) === 1;
}

export async function releaseAfterError(db: D1Database, reserved: ReservedPhoto, error: string): Promise<void> {
  await db
    .prepare(
      `UPDATE photos SET status = 'recebida', status_at = ?2, error = ?4
       WHERE id = ?1 AND status = 'processando' AND status_at = ?3`,
    )
    .bind(reserved.id, nowIso(), reserved.status_at, error)
    .run();
}

export async function failExhaustedPhotos(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE photos SET status = 'falhou', status_at = ?1
       WHERE status = 'recebida' AND attempts >= ${MAX_ATTEMPTS} AND deleted_at IS NULL`,
    )
    .bind(nowIso())
    .run();
}

async function removeAbandonedUploads(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, group_id, status_at FROM photos WHERE status = 'enviando' AND status_at < ?1")
    .bind(isoBefore(UPLOAD_TIMEOUT_MS))
    .all<ReservedPhoto>();
  for (const photo of results) {
    // Row first: an upload still in flight then fails its own transition and removes its object.
    const deleted = await env.DB.prepare("DELETE FROM photos WHERE id = ?1 AND status = 'enviando' AND status_at = ?2")
      .bind(photo.id, photo.status_at)
      .run();
    if (changedRows(deleted) === 1) await env.BUCKET.delete(photoKeys(photo).original);
  }
}

/** What the cron does when nothing else moved a photo out of a non-terminal state. */
export async function sweepPhotoStates(env: Env): Promise<void> {
  await removeAbandonedUploads(env);
  await env.DB.prepare("UPDATE photos SET status = 'recebida', status_at = ?1 WHERE status = 'processando' AND status_at < ?2")
    .bind(nowIso(), isoBefore(PROCESSING_TIMEOUT_MS))
    .run();
  await failExhaustedPhotos(env.DB);
}

export async function resetForReprocess(db: D1Database, photoId: string): Promise<boolean> {
  const updated = await db
    .prepare(
      `UPDATE photos SET status = 'recebida', attempts = 0, status_at = ?2, error = NULL
       WHERE id = ?1 AND status IN ('processada', 'falhou') AND deleted_at IS NULL`,
    )
    .bind(photoId, nowIso())
    .run();
  return changedRows(updated) === 1;
}

export async function isPhotoGone(db: D1Database, photoId: string): Promise<boolean> {
  const alive = await db.prepare("SELECT 1 FROM photos WHERE id = ?1 AND deleted_at IS NULL").bind(photoId).first();
  return alive === null;
}

/**
 * Definitive: the R2 objects, faces, scores and tags go now; the row stays only as the receipt
 * of the uploader's monthly usage. An upload that never completed leaves no receipt.
 */
export async function deletePhoto(env: Env, photo: PhotoRow): Promise<void> {
  const keys = photoKeys(photo);
  const abandoned = await env.DB.prepare("DELETE FROM photos WHERE id = ?1 AND status = 'enviando'").bind(photo.id).run();
  if (changedRows(abandoned) === 1) return env.BUCKET.delete(keys.original);
  await env.DB.batch([
    env.DB.prepare("UPDATE photos SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL").bind(photo.id, nowIso()),
    env.DB.prepare("DELETE FROM faces WHERE photo_id = ?1").bind(photo.id),
    env.DB.prepare("DELETE FROM scores WHERE photo_id = ?1").bind(photo.id),
    env.DB.prepare("DELETE FROM tags WHERE photo_id = ?1").bind(photo.id),
  ]);
  await env.BUCKET.delete([keys.original, keys.preview, keys.thumb]);
}

// ---- Upload and download ----

async function storeOriginal(env: Env, photo: PhotoRow, request: Request): Promise<void> {
  const mismatch = new ApiError(400, "size_mismatch", "O tamanho enviado é diferente do tamanho declarado.");
  if (!request.body || Number(request.headers.get("content-length")) !== photo.size_bytes) throw mismatch;
  const key = photoKeys(photo).original;
  const stored = await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: photo.content_type } });
  if (stored.size !== photo.size_bytes) {
    await env.BUCKET.delete(key);
    throw mismatch;
  }
  if (await markReceived(env.DB, photo)) return;
  const rowExists = await env.DB.prepare("SELECT 1 FROM photos WHERE id = ?1").bind(photo.id).first();
  if (!rowExists) await env.BUCKET.delete(key);
  throw notUploading();
}

const notUploading = () => new ApiError(409, "not_uploading", "Essa foto não está aguardando envio.");

/**
 * The one place a client's file name is cleaned, at the slot request: the last path segment,
 * without control characters. The download header and the ZIP read this stored value.
 */
export function normalizeFilename(raw: unknown): string {
  const invalid = invalidRequest(`O campo "filename" é obrigatório e aceita até ${MAX_FILENAME_LENGTH} caracteres.`);
  if (typeof raw !== "string") throw invalid;
  const name = raw
    .split(/[/\\]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .trim();
  if (name === "" || name === "." || name === ".." || name.length > MAX_FILENAME_LENGTH) throw invalid;
  return name;
}

function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function originalResponse(env: Env, photo: PhotoRow): Promise<Response> {
  const object = photo.status === "enviando" ? null : await env.BUCKET.get(photoKeys(photo).original);
  if (!object) throw notFound();
  return new Response(object.body, {
    headers: {
      "content-type": photo.content_type,
      "content-length": String(object.size),
      "content-disposition": attachmentDisposition(photo.filename),
      "cache-control": "private, no-store",
    },
  });
}

async function derivedResponse(env: Env, photo: PhotoRow, kind: "thumb" | "preview"): Promise<Response> {
  const object = photo.status === "processada" ? await env.BUCKET.get(photoKeys(photo)[kind]) : null;
  if (!object) throw notFound();
  return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": DERIVED_CACHE } });
}

interface ZipPhotoRow extends PhotoLocation {
  filename: string;
  size_bytes: number;
  created_at: string;
}

async function zipResponse(env: Env, groupId: string, photoIds: string[]): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.group_id, p.filename, p.size_bytes, p.created_at FROM photos p
     WHERE p.group_id = ?1 AND ${LISTED_PHOTO} AND p.id IN (SELECT value FROM json_each(?2))
     ORDER BY p.created_at, p.id`,
  )
    .bind(groupId, JSON.stringify(photoIds))
    .all<ZipPhotoRow>();
  if (results.length !== new Set(photoIds).size) throw notFound();
  const totalBytes = results.reduce((total, photo) => total + photo.size_bytes, 0);
  if (results.length > MAX_ZIP_ENTRIES || totalBytes > MAX_ZIP_BYTES) {
    throw new ApiError(413, "download_too_large", "A seleção é grande demais para um só arquivo ZIP. Baixe em partes.");
  }
  const entries = results.map((photo) => ({
    name: photo.filename,
    modifiedAt: new Date(photo.created_at),
    open: async () => {
      const object = await env.BUCKET.get(photoKeys(photo).original);
      if (!object) throw new Error(`original of photo ${photo.id} is missing`);
      return object.body;
    },
  }));
  return new Response(zipStream(entries), {
    headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="fotos.zip"' },
  });
}

// ---- The Photo of the API contract ----

interface PhotoViewRow extends PhotoRow {
  uploader_name: string;
  mine: number;
  my_tag: "me" | "not_me" | null;
}

/** `?1` is the viewer. */
const PHOTO_VIEW_SQL = `SELECT p.*, u.name AS uploader_name, ${appearsIn("?1")} AS mine,
    (SELECT value FROM tags WHERE photo_id = p.id AND user_id = ?1) AS my_tag
  FROM photos p JOIN users u ON u.id = p.uploader_id`;

const RECENT_FIRST = "ORDER BY p.created_at DESC, p.id DESC";

function toPhoto(row: PhotoViewRow, viewer: User) {
  const processed = row.status === "processada";
  return {
    id: row.id,
    groupId: row.group_id,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    status: row.status satisfies PhotoStatus,
    createdAt: row.created_at,
    thumbUrl: processed ? `/api/photos/${row.id}/thumb` : null,
    previewUrl: processed ? `/api/photos/${row.id}/preview` : null,
    originalUrl: `/api/photos/${row.id}/original`,
    mine: row.mine === 1,
    myTag: row.my_tag,
    canDelete: row.uploader_id === viewer.id || viewer.isAdmin,
  };
}

async function loadPhotoView(db: D1Database, viewer: User, photoId: string) {
  const row = await db.prepare(`${PHOTO_VIEW_SQL} WHERE p.id = ?2`).bind(viewer.id, photoId).first<PhotoViewRow>();
  if (!row) throw notFound();
  return toPhoto(row, viewer);
}

type Cursor = [createdAt: string, id: string];

function decodeCursor(cursor: string | undefined): Cursor | [null, null] {
  if (!cursor) return [null, null];
  try {
    const [createdAt, id] = JSON.parse(atob(cursor)) as unknown[];
    if (typeof createdAt === "string" && typeof id === "string") return [createdAt, id];
  } catch {
    // A cursor that is not base64 JSON is rejected below, like one with the wrong shape.
  }
  throw invalidRequest("Cursor inválido.");
}

/** `all` → no filter; `mine` → the viewer; `user:<id>` → that user. */
function filterUserId(filter: string, viewer: User): string | null {
  if (filter === "all") return null;
  if (filter === "mine") return viewer.id;
  if (filter.startsWith("user:") && filter.length > 5) return filter.slice(5);
  throw invalidRequest('O filtro precisa ser "all", "mine" ou "user:<id>".');
}

async function listGroupPhotos(db: D1Database, viewer: User, groupId: string, filter: string, cursor: string | undefined) {
  const { results } = await db
    .prepare(
      `${PHOTO_VIEW_SQL}
       WHERE p.group_id = ?2 AND ${LISTED_PHOTO}
         AND (?3 IS NULL OR (p.created_at, p.id) < (?3, ?4))
         AND (?5 IS NULL OR ${appearsIn("?5")})
       ${RECENT_FIRST} LIMIT ${PAGE_SIZE + 1}`,
    )
    .bind(viewer.id, groupId, ...decodeCursor(cursor), filterUserId(filter, viewer))
    .all<PhotoViewRow>();
  const page = results.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor = results.length > PAGE_SIZE ? btoa(JSON.stringify([last.created_at, last.id])) : null;
  return { photos: page.map((row) => toPhoto(row, viewer)), nextCursor };
}

async function listMyPhotos(db: D1Database, viewer: User) {
  const [groups, photos] = await db.batch([
    db
      .prepare(
        `SELECT g.id, g.name FROM groups g JOIN memberships m ON m.group_id = g.id AND m.user_id = ?1
         ORDER BY g.created_at DESC`,
      )
      .bind(viewer.id),
    db
      .prepare(
        `${PHOTO_VIEW_SQL} JOIN memberships m ON m.group_id = p.group_id AND m.user_id = ?1
         WHERE ${LISTED_PHOTO} AND ${appearsIn("?1")} ${RECENT_FIRST}`,
      )
      .bind(viewer.id),
  ]);
  const mine = (photos.results as PhotoViewRow[]).map((row) => toPhoto(row, viewer));
  return (groups.results as { id: string; name: string }[]).map((group) => ({
    ...group,
    photos: mine.filter((photo) => photo.groupId === group.id),
  }));
}

async function setTag(db: D1Database, user: User, photo: PhotoRow, value: unknown): Promise<void> {
  if (value === null) {
    await db.prepare("DELETE FROM tags WHERE photo_id = ?1 AND user_id = ?2").bind(photo.id, user.id).run();
    return;
  }
  if (value !== "me" && value !== "not_me") throw invalidRequest('A marca precisa ser "me", "not_me" ou null.');
  await db
    .prepare(
      `INSERT INTO tags (photo_id, user_id, value)
       SELECT p.id, ?2, ?3 FROM photos p WHERE p.id = ?1 AND ${LISTED_PHOTO}
       ON CONFLICT (photo_id, user_id) DO UPDATE SET value = excluded.value`,
    )
    .bind(photo.id, user.id, value)
    .run();
}

function readPhotoIds(body: Record<string, unknown>): string[] {
  const ids = body.photoIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
    throw invalidRequest('O campo "photoIds" precisa ser uma lista de ids, com pelo menos um.');
  }
  return ids;
}

export const photoRoutes = new Hono<AppEnv>();

photoRoutes.get("/groups/:id/photos", async (c) => {
  const user = c.get("user");
  const group = await requireMember(c.env.DB, user, c.req.param("id"));
  return c.json(await listGroupPhotos(c.env.DB, user, group.id, c.req.query("filter") ?? "all", c.req.query("cursor")));
});

photoRoutes.post("/groups/:id/photos", async (c) => {
  const user = c.get("user");
  const group = await requireMember(c.env.DB, user, c.req.param("id"));
  const body = await readJsonObject(c);
  const filename = normalizeFilename(body.filename);
  const contentType = readText(body, "contentType", 100).toLowerCase();
  const sizeBytes = readPositiveInteger(body, "sizeBytes");
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new ApiError(415, "unsupported_type", "Formato não aceito. Envie JPEG, HEIC, PNG ou WebP.");
  }
  const id = await reservePhotoSlot(c.env.DB, { groupId: group.id, userId: user.id, filename, contentType, sizeBytes });
  return c.json({ photo: { id }, uploadUrl: `/api/photos/${id}/original` });
});

photoRoutes.post("/groups/:id/download", async (c) => {
  const group = await requireMember(c.env.DB, c.get("user"), c.req.param("id"));
  return zipResponse(c.env, group.id, readPhotoIds(await readJsonObject(c)));
});

photoRoutes.get("/me/photos", async (c) => c.json({ groups: await listMyPhotos(c.env.DB, c.get("user")) }));

photoRoutes.put("/photos/:id/original", async (c) => {
  const user = c.get("user");
  const photo = await loadPhotoFor(c.env.DB, user, c.req.param("id"));
  if (photo.uploader_id !== user.id) throw new ApiError(403, "forbidden", "Só quem pediu o envio pode enviar o arquivo.");
  if (photo.status !== "enviando") throw notUploading();
  await storeOriginal(c.env, photo, c.req.raw);
  return c.json({ photo: await loadPhotoView(c.env.DB, user, photo.id) });
});

photoRoutes.get("/photos/:id/original", async (c) =>
  originalResponse(c.env, await loadPhotoFor(c.env.DB, c.get("user"), c.req.param("id"))),
);

photoRoutes.get("/photos/:id/:kind{thumb|preview}", async (c) =>
  derivedResponse(c.env, await loadPhotoFor(c.env.DB, c.get("user"), c.req.param("id")), c.req.param("kind") as "thumb" | "preview"),
);

photoRoutes.put("/photos/:id/tag", async (c) => {
  const user = c.get("user");
  const photo = await loadPhotoFor(c.env.DB, user, c.req.param("id"));
  await setTag(c.env.DB, user, photo, (await readJsonObject(c)).value);
  return c.json({ photo: await loadPhotoView(c.env.DB, user, photo.id) });
});

photoRoutes.delete("/photos/:id", async (c) => {
  const user = c.get("user");
  const photo = await loadPhotoFor(c.env.DB, user, c.req.param("id"));
  if (photo.uploader_id !== user.id && !user.isAdmin) {
    throw new ApiError(403, "forbidden", "Só quem enviou a foto ou o administrador pode apagá-la.");
  }
  await deletePhoto(c.env, photo);
  return c.body(null, 204);
});
