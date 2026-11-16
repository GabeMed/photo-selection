import { deleteExpiredSessions } from "./auth";
import { nowIso } from "./db";
import { analyzeImage, FaceServiceError, FaceServiceUnavailable, isFaceServiceReady } from "./face-service";
import { fillMissingScores, rescore } from "./matching";
import {
  completeProcessing,
  failExhaustedPhotos,
  hasReservablePhoto,
  isPhotoGone,
  photoKeys,
  releaseAfterError,
  reserveNextPhoto,
  sweepPhotoStates,
  type ReservedPhoto,
} from "./photos";

export const DRAIN_CONCURRENCY = 2;
// The cron fires every 60 s and a photo reserved at 40 s takes ~15 s at worst in the common case (12 and 48 MP in parallel, measured in production) plus its writes: 40 + 15 + 5 = 60, so a drain ends before the next one starts.
const DRAIN_BUDGET_MS = 40_000;

/**
 * The only trigger of processing, run by the cron. The face service is asked for health before
 * anything is reserved, so an unavailable container never spends an attempt; and it is only
 * asked when there is work, so an idle site does not keep the container awake.
 */
export async function drain(env: Env): Promise<void> {
  // Counted from the start of the drain: after a slow cold start this drain reserves nothing and the next one works.
  const deadline = Date.now() + DRAIN_BUDGET_MS;
  await sweepPhotoStates(env);
  await deleteExpiredSessions(env.DB);
  await processWaitingPhotos(env, deadline);
  await fillMissingScores(env.DB);
}

async function processWaitingPhotos(env: Env, deadline: number): Promise<void> {
  if (!(await hasReservablePhoto(env.DB))) return;
  if (!(await isFaceServiceReady(env))) return;
  const attempted: string[] = [];
  await Promise.all(Array.from({ length: DRAIN_CONCURRENCY }, () => processUntil(env, attempted, deadline)));
  await failExhaustedPhotos(env.DB);
}

async function processUntil(env: Env, attempted: string[], deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const photo = await reserveNextPhoto(env.DB, attempted);
    if (!photo) return;
    attempted.push(photo.id);
    const outcome = await analyzeAndStore(env, photo);
    if (outcome === "stored") await rescore(env.DB, { photoIds: [photo.id] });
    if (outcome === "unavailable") return;
  }
}

type Outcome = "stored" | "superseded" | "failed" | "unavailable";

async function analyzeAndStore(env: Env, photo: ReservedPhoto): Promise<Outcome> {
  try {
    return (await storeAnalysis(env, photo)) ? "stored" : "superseded";
  } catch (error) {
    console.error(`processing photo ${photo.id} failed`, error);
    return releaseAfter(env.DB, photo, error);
  }
}

/** Only a failure that is about this photo costs it the attempt counted at reservation. */
async function releaseAfter(db: D1Database, photo: ReservedPhoto, error: unknown): Promise<Outcome> {
  if (error instanceof FaceServiceUnavailable) {
    await leaveReservation(db, photo, "status = 'recebida', attempts = attempts - 1", String(error));
    return "unavailable";
  }
  if (error instanceof FaceServiceError && error.status === 422) {
    await leaveReservation(db, photo, "status = 'falhou'", String(error));
    return "failed";
  }
  await releaseAfterError(db, photo, String(error));
  return "failed";
}

/** Conditional on the reservation still being this one, so the attempt given back is the one it counted. */
async function leaveReservation(db: D1Database, photo: ReservedPhoto, change: string, error: string): Promise<void> {
  await db
    .prepare(`UPDATE photos SET ${change}, status_at = ?2, error = ?4 WHERE id = ?1 AND status = 'processando' AND status_at = ?3`)
    .bind(photo.id, nowIso(), photo.status_at, error)
    .run();
}

async function storeAnalysis(env: Env, photo: ReservedPhoto): Promise<boolean> {
  const keys = photoKeys(photo);
  const original = await env.BUCKET.get(keys.original);
  if (!original) throw new Error("original object is missing");
  const analysis = await analyzeImage(env, original.body);
  const jpeg = { httpMetadata: { contentType: "image/jpeg" } };
  await Promise.all([env.BUCKET.put(keys.preview, analysis.preview, jpeg), env.BUCKET.put(keys.thumb, analysis.thumb, jpeg)]);
  if (await completeProcessing(env.DB, photo, analysis)) return true;
  // A photo that still exists lost its reservation to a newer attempt, which owns these same keys.
  if (await isPhotoGone(env.DB, photo.id)) await env.BUCKET.delete([keys.preview, keys.thumb]);
  return false;
}
