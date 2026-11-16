import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";
import { drain } from "../src/worker/processing";
import { scriptedImage, type FakeFaceService, type FakeScript } from "./fake-face-service";

export { env };

export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_SETUP_CODE = "test-setup-code";
const PASSWORD = "correct horse battery";

export interface Session {
  cookie: string;
  id: string;
  email: string;
}

export interface ApiInit {
  method?: string;
  as?: Session;
  json?: unknown;
  body?: Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
}

export function api(path: string, init: ApiInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.as) headers.set("cookie", init.as.cookie);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  const method = init.method ?? (body === undefined ? "GET" : "POST");
  return exports.default.fetch(new Request(`https://photos.test${path}`, { method, headers, body, redirect: "manual" }));
}

/** Asserts the status and returns the parsed JSON body. */
export async function json<T = any>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const settled = await response;
  const text = await settled.text();
  expect(settled.status, text).toBe(status);
  return (text ? JSON.parse(text) : null) as T;
}

export async function expectError(response: Response | Promise<Response>, status: number, code: string): Promise<string> {
  const body = await json<{ error: { code: string; message: string } }>(response, status);
  expect(body.error.code).toBe(code);
  return body.error.message;
}

const sessionCookie = (response: Response) => response.headers.get("set-cookie")!.split(";")[0];

export async function signup(name: string, extra: Record<string, unknown> = {}): Promise<Session> {
  const email = `${name.toLowerCase()}@example.com`;
  const response = await api("/api/auth/signup", { json: { email, name, password: PASSWORD, ...extra } });
  const cookie = sessionCookie(response);
  const { user } = await json(response);
  return { cookie, id: user.id, email };
}

export const signupAdmin = () => signup("Admin", { setupCode: ADMIN_SETUP_CODE });

export async function login(email: string, password = PASSWORD): Promise<Response> {
  return api("/api/auth/login", { json: { email, password } });
}

export interface TestGroup {
  id: string;
  inviteToken: string;
}

export async function createGroup(admin: Session, name = "Viagem", quotaBytes?: number): Promise<TestGroup> {
  const { group } = await json(api("/api/admin/groups", { as: admin, json: { name, quotaBytes } }));
  return group;
}

export async function join(user: Session, group: TestGroup): Promise<void> {
  await json(api(`/api/invites/${group.inviteToken}/join`, { as: user, method: "POST" }));
}

/** A group with the admin and the named friends as members. */
export async function groupWith(...names: string[]) {
  const admin = await signupAdmin();
  const group = await createGroup(admin);
  const friends: Session[] = [];
  for (const name of names) {
    const friend = await signup(name);
    await join(friend, group);
    friends.push(friend);
  }
  return { admin, group, friends };
}

export function requestSlot(user: Session, groupId: string, sizeBytes: number, filename = "foto.jpg", contentType = "image/jpeg") {
  return api(`/api/groups/${groupId}/photos`, { as: user, json: { filename, contentType, sizeBytes } });
}

export function putOriginal(user: Session, photoId: string, bytes: Uint8Array<ArrayBuffer>, declaredLength = bytes.length) {
  return api(`/api/photos/${photoId}/original`, {
    as: user,
    method: "PUT",
    body: bytes,
    headers: { "content-length": String(declaredLength) },
  });
}

export async function upload(user: Session, groupId: string, bytes: Uint8Array<ArrayBuffer>, filename = "foto.jpg"): Promise<string> {
  const { photo } = await json(requestSlot(user, groupId, bytes.length, filename));
  await json(putOriginal(user, photo.id, bytes));
  return photo.id;
}

/** Each call sends a different file: the same bytes twice in a group would be a duplicate. */
export const uploadScripted = (user: Session, groupId: string, script: FakeScript, filename?: string) =>
  upload(user, groupId, scriptedImage(script, randomBytes(16)), filename);

export async function addSelfie(user: Session, script: FakeScript): Promise<Response> {
  return api("/api/me/selfies", { as: user, body: scriptedImage(script), headers: { "content-type": "image/jpeg" } });
}

export const runCron = () => drain(env);

export const fakeFaceService = () =>
  (env.FACE_SERVICE as unknown as DurableObjectNamespace<FakeFaceService>).getByName("singleton");

export async function photoRow(photoId: string) {
  const row = await env.DB.prepare("SELECT * FROM photos WHERE id = ?1").bind(photoId).first<Record<string, any>>();
  return row!;
}

export async function myPhotoIds(user: Session): Promise<string[]> {
  const { groups } = await json(api("/api/me/photos", { as: user }));
  return groups.flatMap((group: any) => group.photos.map((photo: any) => photo.id));
}

export async function storedKeys(): Promise<string[]> {
  return (await env.BUCKET.list()).objects.map((object) => object.key).sort();
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 65536) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, length)));
  }
  return bytes;
}

export async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await scheduler.wait(10);
  }
  throw new Error("condition was not met in time");
}
