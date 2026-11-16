import { describe, expect, it } from "vitest";
import { scriptedImage } from "./fake-face-service";
import { api, createGroup, env, expectError, groupWith, json, randomBytes, requestSlot, runCron, signupAdmin, upload } from "./helpers";

const MB = 1024 * 1024;

describe("A6: limits refuse what would pass them", () => {
  it("refuses an upload over the group quota and gives the space back on delete", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    await json(api(`/api/admin/groups/${group.id}`, { as: admin, method: "PATCH", json: { quotaBytes: 1000 } }));
    const photoId = await upload(ana, group.id, randomBytes(600));

    const message = await expectError(requestSlot(ana, group.id, 401), 409, "group_quota_exceeded");
    expect(message).toContain("usados de");
    await json(requestSlot(ana, group.id, 400));
    await expectError(requestSlot(ana, group.id, 1), 409, "group_quota_exceeded");

    await json(api(`/api/photos/${photoId}`, { as: ana, method: "DELETE" }), 204);
    await json(requestSlot(ana, group.id, 600));
  });

  it("counts the original, the preview and the thumb in the group usage", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const image = scriptedImage({ faces: [1] }, randomBytes(1000));
    const usedBytes = async () => (await json(api(`/api/groups/${group.id}`, { as: ana }))).group.usedBytes;
    await upload(ana, group.id, image);
    expect(await usedBytes()).toBe(image.length);

    await runCron();
    expect(await usedBytes()).toBe(image.length + `preview of ${image.length} bytes`.length + "thumb".length);
  });

  it("refuses an upload over the user's monthly quota, counting deleted photos", async () => {
    const { admin, group, friends: [ana, bia] } = await groupWith("Ana", "Bia");
    await json(api("/api/admin/settings", { as: admin, method: "PATCH", json: { userMonthlyQuotaBytes: 1000 } }));
    const photoId = await upload(ana, group.id, randomBytes(700));
    await json(api(`/api/photos/${photoId}`, { as: ana, method: "DELETE" }), 204);

    const message = await expectError(requestSlot(ana, group.id, 301), 409, "user_quota_exceeded");
    expect(message).toContain("limite mensal");
    await json(requestSlot(ana, group.id, 300));
    await json(requestSlot(bia, group.id, 1000));

    await env.DB.prepare("UPDATE photos SET created_at = '2020-01-15T00:00:00.000Z' WHERE uploader_id = ?1").bind(ana.id).run();
    await json(requestSlot(ana, group.id, 1000));
  });

  it("refuses a file over the maximum size", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    await expectError(requestSlot(ana, group.id, 100 * MB + 1), 413, "file_too_large");
  });

  it("does not create the sixth group until the maximum is raised", async () => {
    const admin = await signupAdmin();
    for (let index = 1; index <= 5; index++) await createGroup(admin, `Grupo ${index}`);
    await expectError(api("/api/admin/groups", { as: admin, json: { name: "Grupo 6" } }), 409, "max_groups_reached");

    await json(api("/api/admin/settings", { as: admin, method: "PATCH", json: { maxGroups: 6 } }));
    const sixth = await createGroup(admin, "Grupo 6");
    expect(sixth).toMatchObject({ name: "Grupo 6", quotaBytes: 2 * 1024 * MB, memberCount: 1 });
  });

  it("lets only as many simultaneous slot requests through as fit", async () => {
    const { admin, group, friends: [ana] } = await groupWith("Ana");
    await json(api(`/api/admin/groups/${group.id}`, { as: admin, method: "PATCH", json: { quotaBytes: 1000 } }));

    const responses = await Promise.all([1, 2, 3].map(() => requestSlot(ana, group.id, 400)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 409]);
    expect((await json(api(`/api/groups/${group.id}`, { as: ana }))).group.usedBytes).toBe(800);
  });
});
