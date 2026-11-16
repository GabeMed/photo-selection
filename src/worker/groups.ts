import { Hono } from "hono";
import { nowIso } from "./db";
import { notFound, outliveRequest, type AppEnv, type User } from "./http";
import { appearsIn, rescore } from "./matching";
import { groupUsedBytesSql } from "./quota";

export type PhotoStatus = "enviando" | "recebida" | "processando" | "processada" | "falhou";

export interface PhotoRow {
  id: string;
  group_id: string;
  uploader_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  status: PhotoStatus;
  attempts: number;
  created_at: string;
  status_at: string;
}

/** A photo the group can see: not deleted and with its bytes already received. Requires the alias `p`. */
export const LISTED_PHOTO = "p.deleted_at IS NULL AND p.status <> 'enviando'";

export interface GroupRow {
  id: string;
  name: string;
  invite_token: string;
  quota_bytes: number;
}

/** The single gate to a group: non-members get the same 404 as a group that does not exist. */
export async function requireMember(db: D1Database, user: User, groupId: string): Promise<GroupRow> {
  const group = await db
    .prepare(
      `SELECT g.id, g.name, g.invite_token, g.quota_bytes FROM groups g
       JOIN memberships m ON m.group_id = g.id AND m.user_id = ?2 WHERE g.id = ?1`,
    )
    .bind(groupId, user.id)
    .first<GroupRow>();
  if (!group) throw notFound();
  return group;
}

/** The single loader of a photo: photo → group → member → not deleted; anything else is a 404. */
export async function loadPhotoFor(db: D1Database, user: User, photoId: string): Promise<PhotoRow> {
  const photo = await db
    .prepare(
      `SELECT p.* FROM photos p JOIN memberships m ON m.group_id = p.group_id AND m.user_id = ?2
       WHERE p.id = ?1 AND p.deleted_at IS NULL`,
    )
    .bind(photoId, user.id)
    .first<PhotoRow>();
  if (!photo) throw notFound();
  return photo;
}

interface GroupSummaryRow extends GroupRow {
  created_at: string;
  member_count: number;
  used_bytes: number;
  total: number;
  processing: number;
  failed: number;
  my_photo_count: number;
}

export interface GroupSummary {
  id: string;
  name: string;
  inviteToken: string;
  createdAt: string;
  memberCount: number;
  photoCount: number;
  usedBytes: number;
  quotaBytes: number;
  myPhotoCount: number;
  counts: { total: number; processing: number; failed: number };
}

const countPhotosSql = (condition: string) =>
  `(SELECT COUNT(*) FROM photos p WHERE p.group_id = g.id AND ${LISTED_PHOTO} AND ${condition})`;

export interface GroupSelection {
  groupId?: string;
  /** When set, only groups this viewer belongs to; the admin overview leaves it unset. */
  memberOnly: boolean;
}

export async function loadGroupSummaries(db: D1Database, viewerId: string, selection: GroupSelection): Promise<GroupSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.name, g.invite_token, g.quota_bytes, g.created_at,
              (SELECT COUNT(*) FROM memberships m WHERE m.group_id = g.id) AS member_count,
              ${groupUsedBytesSql("g.id")} AS used_bytes,
              ${countPhotosSql("1")} AS total,
              ${countPhotosSql("p.status IN ('recebida', 'processando')")} AS processing,
              ${countPhotosSql("p.status = 'falhou'")} AS failed,
              ${countPhotosSql(appearsIn("?1"))} AS my_photo_count
       FROM groups g
       WHERE (?2 IS NULL OR g.id = ?2)
         AND (?3 = 0 OR EXISTS (SELECT 1 FROM memberships m WHERE m.group_id = g.id AND m.user_id = ?1))
       ORDER BY g.created_at DESC`,
    )
    .bind(viewerId, selection.groupId ?? null, selection.memberOnly ? 1 : 0)
    .all<GroupSummaryRow>();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    inviteToken: row.invite_token,
    createdAt: row.created_at,
    memberCount: row.member_count,
    photoCount: row.total,
    usedBytes: row.used_bytes,
    quotaBytes: row.quota_bytes,
    myPhotoCount: row.my_photo_count,
    counts: { total: row.total, processing: row.processing, failed: row.failed },
  }));
}

interface Member {
  id: string;
  name: string;
}

/** In the order they joined: the frontend gives each person a color by this position. */
async function loadMembers(db: D1Database, groupId: string): Promise<Member[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?1 ORDER BY m.joined_at, m.user_id`,
    )
    .bind(groupId)
    .all<Member>();
  return results;
}

interface InvitedGroup {
  id: string;
  name: string;
  member_count: number;
  already_member: number;
  invited_by_id: string;
  invited_by_name: string;
}

/** How many members the invite shows by name; the rest are only counted. */
const INVITE_MEMBERS_SHOWN = 8;

async function loadInvite(db: D1Database, user: User, token: string): Promise<InvitedGroup> {
  const group = await db
    .prepare(
      `SELECT g.id, g.name, u.id AS invited_by_id, u.name AS invited_by_name,
              (SELECT COUNT(*) FROM memberships m WHERE m.group_id = g.id) AS member_count,
              EXISTS (SELECT 1 FROM memberships m WHERE m.group_id = g.id AND m.user_id = ?2) AS already_member
       FROM groups g JOIN users u ON u.id = g.created_by WHERE g.invite_token = ?1`,
    )
    .bind(token, user.id)
    .first<InvitedGroup>();
  if (!group) throw notFound();
  return group;
}

const inviteJson = (group: InvitedGroup) => ({ id: group.id, name: group.name, memberCount: group.member_count });

/** Writes the membership first and only then reads the group's faces, as the rescore order rule demands. */
async function joinGroup(db: D1Database, user: User, token: string): Promise<InvitedGroup> {
  const invited = await loadInvite(db, user, token);
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, joined_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING")
    .bind(invited.id, user.id, nowIso())
    .run();
  await rescore(db, { userIds: [user.id] });
  return loadInvite(db, user, token);
}

export const groupRoutes = new Hono<AppEnv>();

groupRoutes.get("/groups", async (c) => {
  const summaries = await loadGroupSummaries(c.env.DB, c.get("user").id, { memberOnly: true });
  const groups = summaries.map(({ id, name, createdAt, memberCount, photoCount, usedBytes, quotaBytes, myPhotoCount }) => ({
    id,
    name,
    createdAt,
    memberCount,
    photoCount,
    usedBytes,
    quotaBytes,
    myPhotoCount,
  }));
  return c.json({ groups });
});

groupRoutes.get("/groups/:id", async (c) => {
  const user = c.get("user");
  const { id } = await requireMember(c.env.DB, user, c.req.param("id"));
  const [summary] = await loadGroupSummaries(c.env.DB, user.id, { groupId: id, memberOnly: true });
  const { name, inviteToken, usedBytes, quotaBytes, counts } = summary;
  const members = await loadMembers(c.env.DB, id);
  return c.json({ group: { id, name, inviteToken, usedBytes, quotaBytes, members, counts } });
});

groupRoutes.get("/invites/:token", async (c) => {
  const invited = await loadInvite(c.env.DB, c.get("user"), c.req.param("token"));
  const members = (await loadMembers(c.env.DB, invited.id)).slice(0, INVITE_MEMBERS_SHOWN);
  const invitedBy = { id: invited.invited_by_id, name: invited.invited_by_name };
  return c.json({ group: { ...inviteJson(invited), invitedBy, members }, alreadyMember: invited.already_member === 1 });
});

groupRoutes.post("/invites/:token/join", async (c) => {
  const invited = await outliveRequest(c, joinGroup(c.env.DB, c.get("user"), c.req.param("token")));
  return c.json({ group: inviteJson(invited) });
});
