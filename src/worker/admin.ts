import { Hono } from "hono";
import { setPassword } from "./auth";
import { newToken } from "./db";
import { probeFaceService } from "./face-service";
import { loadGroupSummaries, type GroupSummary } from "./groups";
import { ApiError, invalidRequest, notFound, readJsonObject, readPositiveInteger, readText, type AppEnv } from "./http";
import { rescore } from "./matching";
import { resetForReprocess } from "./photos";
import { monthStartIso, monthUsedBytesSql, reserveGroupSlot } from "./quota";
import { loadSettings, saveSettings, type Settings } from "./settings";

const adminGroupJson = ({ myPhotoCount: _, unclaimedCount: __, ...group }: GroupSummary) => group;

const adminSettingsJson = ({ maxFileBytes: _, ...settings }: Settings) => settings;

async function loadAdminGroup(db: D1Database, adminId: string, groupId: string) {
  const [group] = await loadGroupSummaries(db, adminId, { groupId, memberOnly: false });
  if (!group) throw notFound();
  return adminGroupJson(group);
}

async function loadUsers(db: D1Database) {
  const { results } = await db
    .prepare(`SELECT u.id, u.email, u.name, ${monthUsedBytesSql("u.id", "?1")} AS month_used_bytes FROM users u ORDER BY u.name`)
    .bind(monthStartIso())
    .all<{ id: string; email: string; name: string; month_used_bytes: number }>();
  return results.map((row) => ({ id: row.id, email: row.email, name: row.name, monthUsedBytes: row.month_used_bytes }));
}

function readSettingsPatch(body: Record<string, unknown>): Partial<Settings> {
  const patch: Partial<Settings> = {};
  for (const name of ["maxGroups", "defaultGroupQuotaBytes", "userMonthlyQuotaBytes"] as const) {
    if (body[name] !== undefined) patch[name] = readPositiveInteger(body, name);
  }
  if (body.matchThreshold !== undefined) patch.matchThreshold = readThreshold(body.matchThreshold);
  return patch;
}

function readThreshold(value: unknown): number {
  if (typeof value !== "number" || !(value > 0 && value <= 1)) {
    throw invalidRequest('O campo "matchThreshold" precisa ser um número maior que 0 e até 1.');
  }
  return value;
}

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get("/overview", async (c) => {
  const groups = await loadGroupSummaries(c.env.DB, c.get("user").id, { memberOnly: false });
  return c.json({
    settings: adminSettingsJson(await loadSettings(c.env.DB)),
    totalUsedBytes: groups.reduce((total, group) => total + group.usedBytes, 0),
    groups: groups.map(adminGroupJson),
    users: await loadUsers(c.env.DB),
    faceService: { healthy: await probeFaceService(c.env) },
  });
});

adminRoutes.patch("/settings", async (c) => {
  await saveSettings(c.env.DB, readSettingsPatch(await readJsonObject(c)));
  return c.json({ settings: adminSettingsJson(await loadSettings(c.env.DB)) });
});

adminRoutes.post("/groups", async (c) => {
  const admin = c.get("user");
  const body = await readJsonObject(c);
  const name = readText(body, "name", 80);
  const quotaBytes = body.quotaBytes === undefined ? undefined : readPositiveInteger(body, "quotaBytes");
  const id = await reserveGroupSlot(c.env.DB, { name, quotaBytes, createdBy: admin.id });
  return c.json({ group: await loadAdminGroup(c.env.DB, admin.id, id) });
});

adminRoutes.patch("/groups/:id", async (c) => {
  const body = await readJsonObject(c);
  const name = body.name === undefined ? null : readText(body, "name", 80);
  const quotaBytes = body.quotaBytes === undefined ? null : readPositiveInteger(body, "quotaBytes");
  await c.env.DB.prepare("UPDATE groups SET name = COALESCE(?2, name), quota_bytes = COALESCE(?3, quota_bytes) WHERE id = ?1")
    .bind(c.req.param("id"), name, quotaBytes)
    .run();
  return c.json({ group: await loadAdminGroup(c.env.DB, c.get("user").id, c.req.param("id")) });
});

adminRoutes.post("/users/:id/reset-password", async (c) => {
  const temporaryPassword = newToken().slice(0, 12);
  if (!(await setPassword(c.env.DB, c.req.param("id"), temporaryPassword))) throw notFound();
  return c.json({ temporaryPassword });
});

adminRoutes.post("/photos/:id/reprocess", async (c) => {
  const photoId = c.req.param("id");
  if (!(await resetForReprocess(c.env.DB, photoId))) {
    const photo = await c.env.DB.prepare("SELECT 1 FROM photos WHERE id = ?1 AND deleted_at IS NULL").bind(photoId).first();
    if (!photo) throw notFound();
    throw new ApiError(409, "not_reprocessable", "Só fotos já processadas ou que falharam podem ser reprocessadas.");
  }
  await rescore(c.env.DB, { photoIds: [photoId] });
  return c.body(null, 204);
});
