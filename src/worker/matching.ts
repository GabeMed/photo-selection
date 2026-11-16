import { settingSql } from "./settings";

const RESCORE_CHUNK_SIZE = 100;
const BACKFILL_PAIR_LIMIT = 200;
// Stored for a processed photo without faces, so the pair counts as scored and stays below any threshold.
const NO_FACE_SCORE = -1;

/**
 * The single judgement of "this user appears in photo `p`": a manual tag wins,
 * otherwise the stored score is compared with the threshold. Requires the photo alias `p`.
 */
export const appearsIn = (userExpr: string) => `COALESCE(
  (SELECT t.value = 'me' FROM tags t WHERE t.photo_id = p.id AND t.user_id = ${userExpr}),
  (SELECT s.score >= ${settingSql("match_threshold")} FROM scores s WHERE s.photo_id = p.id AND s.user_id = ${userExpr}),
  0)`;

/** Analyzed, and no member of the group appears in it by the one rule above. Requires the photo alias `p`. */
export const isUnclaimed = `(p.status = 'processada' AND NOT EXISTS (
  SELECT 1 FROM memberships um WHERE um.group_id = p.group_id AND ${appearsIn("um.user_id")}))`;

export interface RescoreScope {
  photoIds?: string[];
  userIds?: string[];
}

const idsJson = (ids?: string[]) => (ids ? JSON.stringify(ids) : null);

const IN_PHOTOS = "IN (SELECT value FROM json_each(?1))";
const USER_FILTER = "(?2 IS NULL OR user_id IN (SELECT value FROM json_each(?2)))";

/**
 * The only writer of `scores`: erases every (photo, user) pair in the scope and rewrites them.
 * The whole scope is erased up front, so a rescore that dies midway leaves pairs without a row,
 * which `fillMissingScores` resumes, and never a score from facts that no longer hold.
 */
export async function rescore(db: D1Database, scope: RescoreScope): Promise<void> {
  const userIds = idsJson(scope.userIds);
  await db
    .prepare(`DELETE FROM scores WHERE (?1 IS NULL OR photo_id ${IN_PHOTOS}) AND ${USER_FILTER}`)
    .bind(idsJson(scope.photoIds), userIds)
    .run();
  let cursor = "";
  for (;;) {
    const { results } = await db
      .prepare(
        `SELECT p.id FROM photos p
         WHERE p.deleted_at IS NULL AND p.id > ?3
           AND (?1 IS NULL OR p.id ${IN_PHOTOS})
           AND (?2 IS NULL OR p.group_id IN
                (SELECT group_id FROM memberships WHERE user_id IN (SELECT value FROM json_each(?2))))
         ORDER BY p.id LIMIT ${RESCORE_CHUNK_SIZE}`,
      )
      .bind(idsJson(scope.photoIds), userIds, cursor)
      .all<{ id: string }>();
    if (results.length === 0) return;
    const chunk = results.map((row) => row.id);
    await rescoreChunk(db, JSON.stringify(chunk), userIds);
    cursor = chunk[chunk.length - 1];
  }
}

/**
 * Erases before reading: an event that wrote its own fact (faces, membership, selfie) and then
 * rescored can never erase a pair written by a concurrent event that already saw that fact.
 * The fingerprint check redoes the chunk when faces or selfies changed while it was computed,
 * so a slower concurrent rescore cannot leave a score from stale vectors behind.
 */
async function rescoreChunk(db: D1Database, photoIds: string, userIds: string | null): Promise<void> {
  for (;;) {
    const before = await factsFingerprint(db, photoIds, userIds);
    await db.prepare(`DELETE FROM scores WHERE photo_id ${IN_PHOTOS} AND ${USER_FILTER}`).bind(photoIds, userIds).run();
    const scores = await computeScores(db, photoIds, userIds);
    await db
      .prepare(
        `INSERT OR REPLACE INTO scores (photo_id, user_id, score)
         SELECT p.id, m.user_id, json_extract(j.value, '$[2]')
         FROM json_each(?1) j
         JOIN photos p ON p.id = json_extract(j.value, '$[0]') AND p.status = 'processada' AND p.deleted_at IS NULL
         JOIN memberships m ON m.group_id = p.group_id AND m.user_id = json_extract(j.value, '$[1]')`,
      )
      .bind(JSON.stringify(scores))
      .run();
    if ((await factsFingerprint(db, photoIds, userIds)) === before) return;
  }
}

async function factsFingerprint(db: D1Database, photoIds: string, userIds: string | null): Promise<string> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(group_concat(id), '') FROM
           (SELECT id FROM faces WHERE photo_id ${IN_PHOTOS} ORDER BY id))
         || '|' ||
         (SELECT COALESCE(group_concat(id), '') FROM
           (SELECT id FROM selfies WHERE ${USER_FILTER} AND user_id IN
              (SELECT m.user_id FROM memberships m JOIN photos p ON p.group_id = m.group_id WHERE p.id ${IN_PHOTOS})
            ORDER BY id))
         AS fingerprint`,
    )
    .bind(photoIds, userIds)
    .first<{ fingerprint: string }>();
  return row!.fingerprint;
}

type VectorBlob = ArrayBuffer | number[];
type ScoreRow = [photoId: string, userId: string, score: number];

const toVector = (blob: VectorBlob) => new Float32Array(new Uint8Array(blob).buffer);

async function computeScores(db: D1Database, photoIds: string, userIds: string | null): Promise<ScoreRow[]> {
  const [photos, faces, selfies] = await db.batch([
    db
      .prepare(`SELECT id, group_id FROM photos WHERE status = 'processada' AND deleted_at IS NULL AND id ${IN_PHOTOS}`)
      .bind(photoIds),
    db.prepare(`SELECT photo_id, embedding FROM faces WHERE photo_id ${IN_PHOTOS}`).bind(photoIds),
    db
      .prepare(
        `SELECT m.group_id, s.user_id, s.embedding FROM selfies s JOIN memberships m ON m.user_id = s.user_id
         WHERE m.group_id IN (SELECT group_id FROM photos WHERE id ${IN_PHOTOS})
           AND (?2 IS NULL OR s.user_id IN (SELECT value FROM json_each(?2)))`,
      )
      .bind(photoIds, userIds),
  ]);
  const facesByPhoto = groupVectors(faces.results as VectorRow[], (row) => row.photo_id!);
  const selfiesByGroupUser = groupVectors(selfies.results as VectorRow[], (row) => `${row.group_id} ${row.user_id}`);
  const scores: ScoreRow[] = [];
  for (const photo of photos.results as { id: string; group_id: string }[]) {
    for (const [groupUser, userSelfies] of selfiesByGroupUser) {
      const [groupId, userId] = groupUser.split(" ");
      if (groupId !== photo.group_id) continue;
      scores.push([photo.id, userId, bestCosine(facesByPhoto.get(photo.id) ?? [], userSelfies)]);
    }
  }
  return scores;
}

interface VectorRow {
  photo_id?: string;
  group_id?: string;
  user_id?: string;
  embedding: VectorBlob;
}

function groupVectors(rows: VectorRow[], keyOf: (row: VectorRow) => string): Map<string, Float32Array[]> {
  const groups = new Map<string, Float32Array[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), toVector(row.embedding)]);
  }
  return groups;
}

/** Embeddings are unit vectors, so the dot product is the cosine. */
export function bestCosine(faces: Float32Array[], selfies: Float32Array[]): number {
  let best = NO_FACE_SCORE;
  for (const face of faces) {
    for (const selfie of selfies) {
      let dot = 0;
      for (let index = 0; index < face.length; index++) dot += face[index] * selfie[index];
      best = Math.max(best, dot);
    }
  }
  return best;
}

/** Resumes a rescore that died midway: processed photo × member with a selfie, without a `scores` row. */
export async function fillMissingScores(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT p.id AS photo_id, m.user_id FROM photos p JOIN memberships m ON m.group_id = p.group_id
       WHERE p.status = 'processada' AND p.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM selfies s WHERE s.user_id = m.user_id)
         AND NOT EXISTS (SELECT 1 FROM scores sc WHERE sc.photo_id = p.id AND sc.user_id = m.user_id)
       LIMIT ${BACKFILL_PAIR_LIMIT}`,
    )
    .all<{ photo_id: string; user_id: string }>();
  if (results.length === 0) return;
  await rescore(db, {
    photoIds: [...new Set(results.map((row) => row.photo_id))],
    userIds: [...new Set(results.map((row) => row.user_id))],
  });
}
