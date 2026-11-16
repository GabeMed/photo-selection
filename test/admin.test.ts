import { describe, expect, it } from "vitest";
import { api, expectError, fakeFaceService, groupWith, json, login, randomBytes, upload } from "./helpers";

describe("administration", () => {
  it("is closed to everyone but the admin", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const attempts = [
      api("/api/admin/overview", { as: ana }),
      api("/api/admin/settings", { as: ana, method: "PATCH", json: { maxGroups: 99 } }),
      api(`/api/admin/groups/${group.id}`, { as: ana, method: "PATCH", json: { quotaBytes: 1 } }),
      api(`/api/admin/users/${ana.id}/reset-password`, { as: ana, method: "POST" }),
    ];
    for (const attempt of attempts) await expectError(attempt, 403, "forbidden");
    await expectError(api("/api/admin/overview"), 401, "unauthorized");
  });

  it("shows usage and changes limits", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    await upload(ana, group.id, randomBytes(1234));
    await fakeFaceService().setHealthy(false);

    const overview = await json(api("/api/admin/overview", { as: admin }));
    expect(overview).toMatchObject({
      settings: { maxGroups: 5, defaultGroupQuotaBytes: 2147483648, userMonthlyQuotaBytes: 1073741824, matchThreshold: 0.45 },
      totalUsedBytes: 1234,
      groups: [{ id: group.id, inviteToken: group.inviteToken, memberCount: 2, photoCount: 1, usedBytes: 1234, counts: { total: 1, processing: 1, failed: 0 } }],
      faceService: { healthy: false },
    });
    expect(overview.users.find((user: any) => user.id === ana.id)).toEqual({ id: ana.id, email: ana.email, name: "Ana", monthUsedBytes: 1234 });

    const { settings } = await json(api("/api/admin/settings", { as: admin, method: "PATCH", json: { maxGroups: 8, matchThreshold: 0.5 } }));
    expect(settings).toEqual({ maxGroups: 8, defaultGroupQuotaBytes: 2147483648, userMonthlyQuotaBytes: 1073741824, matchThreshold: 0.5 });
    await expectError(api("/api/admin/settings", { as: admin, method: "PATCH", json: { matchThreshold: 2 } }), 400, "invalid_request");

    const renamed = await json(api(`/api/admin/groups/${group.id}`, { as: admin, method: "PATCH", json: { name: "Novo nome", quotaBytes: 5000 } }));
    expect(renamed.group).toMatchObject({ name: "Novo nome", quotaBytes: 5000 });
    await expectError(api("/api/admin/groups/missing", { as: admin, method: "PATCH", json: { name: "x" } }), 404, "not_found");
  });

  it("resets a friend's password, ending the old sessions", async () => {
    const { admin, friends: [ana] } = await groupWith("Ana");
    const { temporaryPassword } = await json(api(`/api/admin/users/${ana.id}/reset-password`, { as: admin, method: "POST" }));

    await expectError(api("/api/me", { as: ana }), 401, "unauthorized");
    await expectError(login(ana.email), 401, "invalid_credentials");
    expect((await json(login(ana.email, temporaryPassword))).user.id).toBe(ana.id);
    await expectError(api("/api/admin/users/missing/reset-password", { as: admin, method: "POST" }), 404, "not_found");
  });
});
