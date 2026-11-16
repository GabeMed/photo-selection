import { Hono } from "hono";
import { newToken } from "./db";
import { requireMember, type PhotoRow } from "./groups";
import { ApiError, notFound, readJsonObject, type AppContext, type AppEnv } from "./http";
import { ALLOWED_CONTENT_TYPES, deletePhoto, normalizeFilename, storeOriginal, unsupportedType } from "./photos";
import { reservePhotoSlot } from "./quota";

const SNIFF_BYTES = 12;
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
};

/** Keeps the member's current token, or writes a new one when there is none or `rotate` asks for it. */
async function ensureUploadToken(db: D1Database, groupId: string, userId: string, rotate: boolean): Promise<string> {
  const row = await db
    .prepare(
      `UPDATE memberships SET upload_token = CASE WHEN ?4 = 1 OR upload_token IS NULL THEN ?3 ELSE upload_token END
       WHERE group_id = ?1 AND user_id = ?2 RETURNING upload_token`,
    )
    .bind(groupId, userId, newToken(), rotate ? 1 : 0)
    .first<{ upload_token: string }>();
  if (!row) throw notFound();
  return row.upload_token;
}

interface UploadMember {
  group_id: string;
  user_id: string;
}

async function findUploadMember(db: D1Database, token: string): Promise<UploadMember> {
  const member = await db.prepare("SELECT group_id, user_id FROM memberships WHERE upload_token = ?1").bind(token).first<UploadMember>();
  if (!member) throw notFound();
  return member;
}

interface SizedBody {
  body: ReadableStream<Uint8Array>;
  length: number;
}

function readSizedBody(c: AppContext): SizedBody {
  const body = c.req.raw.body;
  const length = Number(c.req.header("content-length") ?? Number.NaN);
  if (!body || !Number.isSafeInteger(length) || length <= 0) {
    throw new ApiError(411, "length_required", "Envie o arquivo com o cabeçalho Content-Length.");
  }
  return { body, length };
}

function sniffImageType(head: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) !== "ftyp") return null;
  const brand = ascii(8, 12);
  if (HEIC_BRANDS.has(brand)) return "image/heic";
  if (HEIF_BRANDS.has(brand)) return "image/heif";
  return null;
}

/** Reads the first bytes, then hands back the whole body again, with the known length R2 requires. */
async function peekBody(body: ReadableStream<Uint8Array>, length: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  while (read < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    read += value.length;
  }
  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  const head = new Uint8Array(await new Blob(chunks).arrayBuffer()).subarray(0, SNIFF_BYTES);
  return { head, body: replay.pipeThrough(new FixedLengthStream(length)) };
}

interface ReceivedFile {
  contentType: string;
  body: ReadableStream;
}

/** The declared type when it is one we accept; otherwise the type the first bytes show. */
async function readFileType(contentTypeHeader: string | undefined, { body, length }: SizedBody): Promise<ReceivedFile> {
  const declared = (contentTypeHeader ?? "").split(";")[0].trim().toLowerCase();
  if (ALLOWED_CONTENT_TYPES.has(declared)) return { contentType: declared, body };
  const peeked = await peekBody(body, length);
  const sniffed = sniffImageType(peeked.head);
  if (!sniffed) throw unsupportedType();
  return { contentType: sniffed, body: peeked.body };
}

function defaultFilename(contentType: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const suffix = [...crypto.getRandomValues(new Uint8Array(2))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `foto-${stamp}-${suffix}.${EXTENSIONS[contentType]}`;
}

/** One call does the slot and the bytes, so a failed transfer gives its reserved space back at once. */
async function storeReservedOriginal(env: Env, photoId: string, body: ReadableStream, length: number): Promise<void> {
  const photo = (await env.DB.prepare("SELECT * FROM photos WHERE id = ?1").bind(photoId).first<PhotoRow>())!;
  try {
    await storeOriginal(env, photo, body, length);
  } catch (error) {
    await deletePhoto(env, photo);
    throw error;
  }
}

export const uploadLinkRoutes = new Hono<AppEnv>();

uploadLinkRoutes.post("/groups/:id/upload-link", async (c) => {
  const user = c.get("user");
  const group = await requireMember(c.env.DB, user, c.req.param("id"));
  const rotate = (await c.req.text()) !== "" && (await readJsonObject(c)).rotate === true;
  const token = await ensureUploadToken(c.env.DB, group.id, user.id, rotate);
  return c.json({ uploadLink: `${new URL(c.req.url).origin}/api/u/${token}` });
});

/** Mounted before the session gate: the token alone authorizes sending photos, and nothing else. */
export const tokenUploadRoutes = new Hono<AppEnv>();

tokenUploadRoutes.post("/:token", async (c) => {
  const member = await findUploadMember(c.env.DB, c.req.param("token"));
  const sized = readSizedBody(c);
  const file = await readFileType(c.req.header("content-type"), sized);
  // An Atalho variable that came out empty sends the header with nothing in it.
  const rawFilename = c.req.header("x-filename")?.trim();
  const filename = rawFilename ? normalizeFilename(rawFilename) : defaultFilename(file.contentType);
  const photoId = await reservePhotoSlot(c.env.DB, {
    groupId: member.group_id,
    userId: member.user_id,
    filename,
    contentType: file.contentType,
    sizeBytes: sized.length,
  });
  await storeReservedOriginal(c.env, photoId, file.body, sized.length);
  return c.json({ ok: true, photoId });
});
