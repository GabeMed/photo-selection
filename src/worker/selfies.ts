import { changedRows, newId, nowIso } from "./db";
import { analyzeImage, FaceServiceError, isFaceServiceReadyWithin, type AnalyzedFace, type Analysis } from "./face-service";
import { ApiError, invalidRequest, notFound, outliveRequest, type AppEnv } from "./http";
import { rescore } from "./matching";
import { Hono } from "hono";

export const MAX_SELFIES = 5;
export const MAX_SELFIE_BYTES = 25 * 1024 ** 2;
// A cold container takes ~90 s to load its models; the selfie request does not hang on that.
export const SELFIE_READY_WAIT_MS = 20_000;
// A face shorter than this share of the tallest one is someone in the background, not the owner of the selfie.
const MAIN_FACE_MIN_HEIGHT_SHARE = 0.4;

export interface SelfieJson {
  id: string;
  url: string;
  createdAt: string;
}

const selfieKey = (userId: string, selfieId: string) => `u/${userId}/selfie/${selfieId}.jpg`;

const toSelfieJson = (row: { id: string; created_at: string }): SelfieJson => ({
  id: row.id,
  url: `/api/me/selfies/${row.id}/image`,
  createdAt: row.created_at,
});

const selfieLimitReached = () =>
  new ApiError(409, "selfie_limit", `Você já tem ${MAX_SELFIES} selfies. Apague uma para adicionar outra.`);

export async function listSelfies(db: D1Database, userId: string): Promise<SelfieJson[]> {
  const { results } = await db
    .prepare("SELECT id, created_at FROM selfies WHERE user_id = ?1 ORDER BY created_at")
    .bind(userId)
    .all<{ id: string; created_at: string }>();
  return results.map(toSelfieJson);
}

async function analyzeSelfie(env: Env, image: ArrayBuffer): Promise<Analysis> {
  try {
    if (await isFaceServiceReadyWithin(env, SELFIE_READY_WAIT_MS)) return await analyzeImage(env, image);
  } catch (error) {
    if (error instanceof FaceServiceError && error.status === 422) throw noFace();
    console.error("selfie analysis failed", error);
    if (error instanceof FaceServiceError) throw analysisFailed();
  }
  throw new ApiError(503, "face_service_unavailable", "A análise de rostos está iniciando. Tente de novo em um minuto.");
}

const noFace = () => new ApiError(422, "no_face", "Não encontramos um rosto nessa imagem. Envie uma foto só do seu rosto.");

const analysisFailed = () =>
  new ApiError(503, "face_service_unavailable", "A análise dessa imagem falhou. Tente de novo ou envie outra foto.");

const faceHeight = (face: AnalyzedFace) => face.box[3];

function mainFaces(faces: AnalyzedFace[]): AnalyzedFace[] {
  const tallest = Math.max(...faces.map(faceHeight));
  return faces.filter((face) => faceHeight(face) >= MAIN_FACE_MIN_HEIGHT_SHARE * tallest);
}

async function addSelfie(env: Env, userId: string, image: ArrayBuffer): Promise<SelfieJson> {
  if ((await listSelfies(env.DB, userId)).length >= MAX_SELFIES) throw selfieLimitReached();
  const analysis = await analyzeSelfie(env, image);
  const [mainFace, ...otherMainFaces] = mainFaces(analysis.faces);
  if (!mainFace) throw noFace();
  if (otherMainFaces.length > 0) {
    throw new ApiError(422, "multiple_faces", "Há mais de um rosto nessa imagem. Envie uma foto só do seu rosto.");
  }
  const selfie = { id: newId(), created_at: nowIso() };
  await env.BUCKET.put(selfieKey(userId, selfie.id), analysis.thumb, { httpMetadata: { contentType: "image/jpeg" } });
  const inserted = await env.DB.prepare(
    `INSERT INTO selfies (id, user_id, embedding, created_at)
     SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM selfies WHERE user_id = ?2) < ${MAX_SELFIES}`,
  )
    .bind(selfie.id, userId, mainFace.embedding, selfie.created_at)
    .run();
  if (changedRows(inserted) === 0) {
    await env.BUCKET.delete(selfieKey(userId, selfie.id));
    throw selfieLimitReached();
  }
  await rescore(env.DB, { userIds: [userId] });
  return toSelfieJson(selfie);
}

export async function removeSelfie(env: Env, userId: string, selfieId: string): Promise<void> {
  const deleted = await env.DB.prepare("DELETE FROM selfies WHERE id = ?1 AND user_id = ?2").bind(selfieId, userId).run();
  if (changedRows(deleted) === 0) throw notFound();
  await env.BUCKET.delete(selfieKey(userId, selfieId));
  await rescore(env.DB, { userIds: [userId] });
}

const selfieTooLarge = () => new ApiError(413, "file_too_large", "A selfie passa do tamanho máximo de 25 MB.");

export const selfieRoutes = new Hono<AppEnv>();

selfieRoutes.post("/me/selfies", async (c) => {
  if (Number(c.req.header("content-length")) > MAX_SELFIE_BYTES) throw selfieTooLarge();
  const image = await c.req.arrayBuffer();
  if (image.byteLength === 0) throw invalidRequest("Envie a imagem no corpo do pedido.");
  if (image.byteLength > MAX_SELFIE_BYTES) throw selfieTooLarge();
  return c.json({ selfie: await outliveRequest(c, addSelfie(c.env, c.get("user").id, image)) });
});

selfieRoutes.delete("/me/selfies/:id", async (c) => {
  await outliveRequest(c, removeSelfie(c.env, c.get("user").id, c.req.param("id")));
  return c.body(null, 204);
});

selfieRoutes.get("/me/selfies/:id/image", async (c) => {
  const userId = c.get("user").id;
  const selfie = await c.env.DB.prepare("SELECT id FROM selfies WHERE id = ?1 AND user_id = ?2")
    .bind(c.req.param("id"), userId)
    .first<{ id: string }>();
  const object = selfie && (await c.env.BUCKET.get(selfieKey(userId, selfie.id)));
  if (!object) throw notFound();
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" },
  });
});
