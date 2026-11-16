import { changedRows, newId, newToken, nowIso } from "./db";
import { ApiError, formatBytes } from "./http";
import { loadSettings, settingSql } from "./settings";

/** Group usage: original + preview + thumb of every photo not deleted, uploads in flight included. */
export const groupUsedBytesSql = (groupExpr: string) =>
  `(SELECT COALESCE(SUM(size_bytes + COALESCE(preview_bytes, 0) + COALESCE(thumb_bytes, 0)), 0)
    FROM photos WHERE group_id = ${groupExpr} AND deleted_at IS NULL)`;

/** Monthly usage: originals the user sent since the month started, deleted or not. */
export const monthUsedBytesSql = (userExpr: string, monthStartExpr: string) =>
  `(SELECT COALESCE(SUM(size_bytes), 0) FROM photos WHERE uploader_id = ${userExpr} AND created_at >= ${monthStartExpr})`;

/** Months turn over in UTC. */
export function monthStartIso(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

export interface PhotoSlotRequest {
  groupId: string;
  userId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** The SHA-256 the client declared, checked when the bytes arrive; null when it declared none. */
  contentHash: string | null;
}

/** Decides and reserves in one statement, so concurrent requests cannot jointly pass a limit. */
export async function reservePhotoSlot(db: D1Database, request: PhotoSlotRequest): Promise<string> {
  const id = newId();
  const inserted = await db
    .prepare(
      `INSERT INTO photos (id, group_id, uploader_id, filename, content_type, size_bytes, status, attempts, created_at, status_at, content_hash)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'enviando', 0, ?7, ?7, ?9
       WHERE ?6 <= ${settingSql("max_file_bytes")}
         AND ${groupUsedBytesSql("?2")} + ?6 <= (SELECT quota_bytes FROM groups WHERE id = ?2)
         AND ${monthUsedBytesSql("?3", "?8")} + ?6 <= ${settingSql("user_monthly_quota_bytes")}`,
    )
    .bind(
      id,
      request.groupId,
      request.userId,
      request.filename,
      request.contentType,
      request.sizeBytes,
      nowIso(),
      monthStartIso(),
      request.contentHash,
    )
    .run();
  if (changedRows(inserted) === 0) throw await explainRefusal(db, request);
  return id;
}

async function explainRefusal(db: D1Database, request: PhotoSlotRequest): Promise<ApiError> {
  const settings = await loadSettings(db);
  if (request.sizeBytes > settings.maxFileBytes) {
    return new ApiError(413, "file_too_large", `O arquivo passa do tamanho máximo de ${formatBytes(settings.maxFileBytes)}.`);
  }
  const usage = await db
    .prepare(
      `SELECT ${groupUsedBytesSql("?1")} AS group_used, (SELECT quota_bytes FROM groups WHERE id = ?1) AS group_quota,
              ${monthUsedBytesSql("?2", "?3")} AS month_used`,
    )
    .bind(request.groupId, request.userId, monthStartIso())
    .first<{ group_used: number; group_quota: number; month_used: number }>();
  if (usage!.group_used + request.sizeBytes > usage!.group_quota) {
    return new ApiError(
      409,
      "group_quota_exceeded",
      `O grupo não tem espaço para esse arquivo: ${formatBytes(usage!.group_used)} usados de ${formatBytes(usage!.group_quota)}.`,
    );
  }
  return new ApiError(
    409,
    "user_quota_exceeded",
    `Você atingiu o seu limite mensal de envio: ${formatBytes(usage!.month_used)} usados de ${formatBytes(settings.userMonthlyQuotaBytes)}.`,
  );
}

export interface GroupSlotRequest {
  name: string;
  quotaBytes?: number;
  createdBy: string;
}

/** Creates the group, with its creator as first member, only while the group count is under the maximum. */
export async function reserveGroupSlot(db: D1Database, request: GroupSlotRequest): Promise<string> {
  const id = newId();
  const now = nowIso();
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO groups (id, name, invite_token, quota_bytes, created_by, created_at)
         SELECT ?1, ?2, ?3, COALESCE(?4, ${settingSql("default_group_quota_bytes")}), ?5, ?6
         WHERE (SELECT COUNT(*) FROM groups) < ${settingSql("max_groups")}`,
      )
      .bind(id, request.name, newToken(), request.quotaBytes ?? null, request.createdBy, now),
    db
      .prepare(
        `INSERT INTO memberships (group_id, user_id, joined_at)
         SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?1)`,
      )
      .bind(id, request.createdBy, now),
  ]);
  if (changedRows(inserted) === 0) {
    throw new ApiError(409, "max_groups_reached", "O número máximo de grupos foi atingido. Aumente o máximo na administração.");
  }
  return id;
}
