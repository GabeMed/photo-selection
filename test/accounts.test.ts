import { describe, expect, it } from "vitest";
import { safeNextPath, signInWithGoogle } from "../src/worker/auth";
import { ADMIN_EMAIL, ADMIN_SETUP_CODE, api, createGroup, env, expectError, groupWith, join, json, login, signup, signupAdmin } from "./helpers";

describe("accounts", () => {
  it("keeps the account across devices: sign up, log out, log in again", async () => {
    const ana = await signup("Ana");
    expect((await json(api("/api/me", { as: ana }))).user).toMatchObject({ name: "Ana", email: "ana@example.com", isAdmin: false, selfies: [] });

    await json(api("/api/auth/logout", { as: ana, method: "POST" }), 204);
    await expectError(api("/api/me", { as: ana }), 401, "unauthorized");

    const again = await login(" Ana@Example.com ");
    expect((await json(again)).user.id).toBe(ana.id);
    await expectError(login("ana@example.com", "wrong password"), 401, "invalid_credentials");
    await expectError(api("/api/auth/signup", { json: { email: "ANA@example.com", name: "Outra", password: "12345678" } }), 409, "email_taken");
  });

  it("stores only a hash of the session token and of the password", async () => {
    const ana = await signup("Ana");
    const token = ana.cookie.split("=")[1];
    const session = await env.DB.prepare("SELECT token_hash FROM sessions").first<{ token_hash: string }>();
    const user = await env.DB.prepare("SELECT password_hash, password_salt FROM users").first<Record<string, string>>();
    expect(session!.token_hash).not.toContain(token);
    expect(user!.password_hash).not.toContain("correct horse");
    expect(user!.password_salt.length).toBeGreaterThan(10);
  });

  it("demands the setup code to register the admin e-mail", async () => {
    const admin = { email: ` ${ADMIN_EMAIL.toUpperCase()} `, name: "Admin", password: "12345678" };
    await expectError(api("/api/auth/signup", { json: admin }), 403, "setup_code_required");
    await expectError(api("/api/auth/signup", { json: { ...admin, setupCode: "wrong" } }), 403, "setup_code_required");
    const { user } = await json(api("/api/auth/signup", { json: { ...admin, setupCode: ADMIN_SETUP_CODE } }));
    expect(user).toMatchObject({ email: ADMIN_EMAIL, isAdmin: true });
  });

  it("links Google to a password account by erasing the password and the old sessions", async () => {
    const ana = await signup("Ana");
    const userId = await signInWithGoogle(env.DB, { sub: "google-ana", email: "Ana@Example.com", name: "Ana G" });
    expect(userId).toBe(ana.id);
    await expectError(api("/api/me", { as: ana }), 401, "unauthorized");
    await expectError(login(ana.email), 401, "invalid_credentials");
    expect(await signInWithGoogle(env.DB, { sub: "google-ana", email: "changed@example.com", name: "Ana G" })).toBe(ana.id);
  });

  it("changes the password, keeping this session and ending the others", async () => {
    const ana = await signup("Ana");
    const otherDevice = { ...ana, cookie: (await login(ana.email)).headers.get("set-cookie")!.split(";")[0] };
    expect((await json(api("/api/me", { as: ana }))).user.hasPassword).toBe(true);
    const change = (body: Record<string, unknown>) => api("/api/me/password", { as: ana, json: body });

    await expectError(change({ currentPassword: "wrong password", newPassword: "a new password" }), 401, "invalid_credentials");
    await expectError(change({ newPassword: "a new password" }), 401, "invalid_credentials");
    await expectError(change({ currentPassword: "correct horse battery", newPassword: "1234567" }), 400, "invalid_request");
    await json(api("/api/me", { as: otherDevice }));

    await json(change({ currentPassword: "correct horse battery", newPassword: "a new password" }), 204);
    await json(api("/api/me", { as: ana }));
    await expectError(api("/api/me", { as: otherDevice }), 401, "unauthorized");
    await expectError(login(ana.email), 401, "invalid_credentials");
    await json(login(ana.email, "a new password"));
  });

  it("lets an account without a password set one without a current password", async () => {
    const ana = await signup("Ana");
    await env.DB.prepare("UPDATE users SET password_hash = NULL, password_salt = NULL WHERE id = ?1").bind(ana.id).run();
    expect((await json(api("/api/me", { as: ana }))).user.hasPassword).toBe(false);

    await json(api("/api/me/password", { as: ana, json: { newPassword: "first password" } }), 204);
    expect((await json(api("/api/me", { as: ana }))).user.hasPassword).toBe(true);
    await json(login(ana.email, "first password"));
  });

  it("names a Google account without a name after the local part of its e-mail", async () => {
    const userId = await signInWithGoogle(env.DB, { sub: "google-nameless", email: "Sem.Nome@Example.com" });
    const user = await env.DB.prepare("SELECT name FROM users WHERE id = ?1").bind(userId).first<{ name: string }>();
    expect(user!.name).toBe("sem.nome");
  });

  it("redirects after Google only to a path of the site itself", () => {
    const origin = "https://photos.test";
    expect(safeNextPath("/g/1", origin)).toBe("/g/1");
    expect(safeNextPath("/j/abc?x=1#top", origin)).toBe("/j/abc?x=1#top");
    const hostile = ["//evil.com", "/\\evil.com", "/\t/evil.com", "/.//evil.com", "https://evil.com", "javascript:alert(1)", "", undefined];
    for (const next of hostile) expect(safeNextPath(next, origin), JSON.stringify(next)).toBe("/");
  });

  it("offers Google only when its credentials exist", async () => {
    expect(await json(api("/api/auth/config"))).toEqual({ googleEnabled: false });
    await expectError(api("/api/auth/google/start"), 404, "not_found");
  });
});

describe("A1: groups and invites", () => {
  it("lets only the admin create a group, and the invite link makes members", async () => {
    const admin = await signupAdmin();
    const ana = await signup("Ana");
    const bia = await signup("Bia");
    await expectError(api("/api/admin/groups", { as: ana, json: { name: "Meu grupo" } }), 403, "forbidden");

    const group = await createGroup(admin, "Chapada");
    await expectError(api(`/api/groups/${group.id}`, { as: ana }), 404, "not_found");
    const invite = await json(api(`/api/invites/${group.inviteToken}`, { as: ana }));
    const adminMember = { id: admin.id, name: "Admin" };
    expect(invite).toEqual({
      group: { id: group.id, name: "Chapada", memberCount: 1, invitedBy: adminMember, members: [adminMember] },
      alreadyMember: false,
    });
    await expectError(api(`/api/invites/${group.inviteToken}`), 401, "unauthorized");

    await join(ana, group);
    await join(bia, group);
    await join(bia, group);

    const seenByBia = await json(api(`/api/groups/${group.id}`, { as: bia }));
    // Ana and Bia may join in the same millisecond; the order itself is covered below.
    expect(seenByBia.group.members.map((member: any) => member.name).sort()).toEqual(["Admin", "Ana", "Bia"]);
    const [listed] = (await json(api("/api/groups", { as: ana }))).groups;
    expect(listed).toMatchObject({ id: group.id, name: "Chapada", memberCount: 3 });
    const { created_at } = (await env.DB.prepare("SELECT created_at FROM groups WHERE id = ?1").bind(group.id).first<{ created_at: string }>())!;
    expect(listed.createdAt).toBe(created_at);
    expect(new Date(listed.createdAt).toISOString()).toBe(listed.createdAt);
    await expectError(api("/api/invites/not-a-token", { as: ana }), 404, "not_found");
  });

  it("lists members in the order they joined, ties broken by id, and shows at most 8 on the invite", async () => {
    const { admin, group, friends } = await groupWith("Zeca", "Ana", "Bia", "Caio", "Duda", "Edu", "Fabi", "Gil", "Hugo");
    const joinedAt = (user: { id: string }, at: string) =>
      env.DB.prepare("UPDATE memberships SET joined_at = ?3 WHERE group_id = ?1 AND user_id = ?2").bind(group.id, user.id, at).run();
    // Zeca joined first, so by name he would come last; Ana and Bia joined in the same millisecond.
    const [zeca, ana, bia] = friends;
    await joinedAt(admin, "2026-01-01T00:00:00.000Z");
    await joinedAt(zeca, "2026-01-01T00:00:01.000Z");
    await joinedAt(bia, "2026-01-01T00:00:02.000Z");
    await joinedAt(ana, "2026-01-01T00:00:02.000Z");
    for (const [index, friend] of friends.slice(3).entries()) await joinedAt(friend, `2026-01-01T00:00:0${3 + index}.000Z`);
    const tied = [ana, bia].sort((one, other) => (one.id < other.id ? -1 : 1));
    const expected = [admin, zeca, ...tied, ...friends.slice(3)].map((user) => user.id);

    const detail = await json(api(`/api/groups/${group.id}`, { as: ana }));
    expect(detail.group.members.map((member: { id: string }) => member.id)).toEqual(expected);

    const outsider = await signup("Ivo");
    const invite = await json(api(`/api/invites/${group.inviteToken}`, { as: outsider }));
    expect(invite.group.memberCount).toBe(10);
    expect(invite.group.invitedBy).toEqual({ id: admin.id, name: "Admin" });
    expect(invite.group.members.map((member: { id: string }) => member.id)).toEqual(expected.slice(0, 8));
  });
});
