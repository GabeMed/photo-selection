import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { changedRows, fromBase64, newId, newToken, nowIso, toBase64 } from "./db";
import { ApiError, invalidRequest, readJsonObject, readText, type AppContext, type AppEnv, type User } from "./http";
import { listSelfies } from "./selfies";

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_NEXT_COOKIE = "oauth_next";
const OAUTH_COOKIE_PATH = "/api/auth/google";
// The Workers runtime refuses PBKDF2 above 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;
const MIN_PASSWORD_LENGTH = 8;

const encoder = new TextEncoder();

export const canonicalEmail = (email: string) => email.trim().toLowerCase();

function requireSecret(env: Env, name: "ADMIN_EMAIL" | "ADMIN_SETUP_CODE" | "SESSION_SECRET"): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const isAdminEmail = (env: Env, email: string) => email === canonicalEmail(requireSecret(env, "ADMIN_EMAIL"));

async function safeEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([left, right].map((text) => crypto.subtle.digest("SHA-256", encoder.encode(text))));
  return crypto.subtle.timingSafeEqual(a, b);
}

async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

async function newPasswordColumns(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await hashPassword(password, salt), salt: toBase64(salt) };
}

function readPassword(body: Record<string, unknown>, key = "password"): string {
  const password = body[key];
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    throw invalidRequest(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  return password;
}

interface StoredPassword {
  password_hash: string | null;
  password_salt: string | null;
}

async function passwordMatches(stored: StoredPassword, attempt: unknown): Promise<boolean> {
  if (!stored.password_hash || !stored.password_salt || typeof attempt !== "string") return false;
  return safeEqual(await hashPassword(attempt, fromBase64(stored.password_salt)), stored.password_hash);
}

/** Replaces the password and ends every session of the user, except the one whose token hash is given. */
export async function setPassword(db: D1Database, userId: string, password: string, keptSessionHash: string | null = null): Promise<boolean> {
  const { hash, salt } = await newPasswordColumns(password);
  const [updated] = await db.batch([
    db.prepare("UPDATE users SET password_hash = ?2, password_salt = ?3 WHERE id = ?1").bind(userId, hash, salt),
    // `IS NOT NULL` holds for every row, so without a kept session all of them go.
    db.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash IS NOT ?2").bind(userId, keptSessionHash),
  ]);
  return changedRows(updated) === 1;
}

async function sessionTokenHash(env: Env, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireSecret(env, "SESSION_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(token))));
}

async function startSession(c: AppContext, userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await sessionTokenHash(c.env, token), userId, expiresAt)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

async function endSession(c: AppContext): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return;
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sessionTokenHash(c.env, token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

export async function deleteExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(nowIso()).run();
}

interface UserRow {
  id: string;
  email: string;
  name: string;
}

const toUser = (env: Env, row: UserRow): User => ({ ...row, isAdmin: isAdminEmail(env, row.email) });

async function findSessionUser(env: Env, token: string): Promise<User | null> {
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
  )
    .bind(await sessionTokenHash(env, token), nowIso())
    .first<UserRow>();
  return row && toUser(env, row);
}

/** The single answer to "who is this person": a valid session, and whether it is the admin. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = token ? await findSessionUser(c.env, token) : null;
  if (!user) throw new ApiError(401, "unauthorized", "Entre na sua conta para continuar.");
  c.set("user", user);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user").isAdmin) throw new ApiError(403, "forbidden", "Só o administrador pode fazer isso.");
  await next();
});

async function userJson(db: D1Database, user: User) {
  const account = await db
    .prepare("SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = ?1")
    .bind(user.id)
    .first<{ has_password: number }>();
  return { ...user, hasPassword: account!.has_password === 1, selfies: await listSelfies(db, user.id) };
}

async function signup(env: Env, body: Record<string, unknown>): Promise<User> {
  const email = canonicalEmail(readText(body, "email", 254));
  const name = readText(body, "name", 80);
  const password = readPassword(body);
  if (isAdminEmail(env, email)) await requireSetupCode(env, body.setupCode);
  const user = { id: newId(), email, name };
  const { hash, salt } = await newPasswordColumns(password);
  const inserted = await env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, password_salt, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (email) DO NOTHING`,
  )
    .bind(user.id, email, name, hash, salt, nowIso())
    .run();
  if (changedRows(inserted) === 0) throw new ApiError(409, "email_taken", "Já existe uma conta com esse e-mail.");
  return toUser(env, user);
}

async function requireSetupCode(env: Env, setupCode: unknown): Promise<void> {
  const expected = requireSecret(env, "ADMIN_SETUP_CODE");
  if (typeof setupCode === "string" && (await safeEqual(setupCode, expected))) return;
  throw new ApiError(403, "setup_code_required", "Esse e-mail exige o código de configuração do administrador.");
}

async function login(env: Env, body: Record<string, unknown>): Promise<User> {
  const invalid = new ApiError(401, "invalid_credentials", "E-mail ou senha incorretos.");
  if (typeof body.email !== "string" || typeof body.password !== "string") throw invalid;
  const row = await env.DB.prepare("SELECT id, email, name, password_hash, password_salt FROM users WHERE email = ?1")
    .bind(canonicalEmail(body.email))
    .first<UserRow & StoredPassword>();
  if (!row || !(await passwordMatches(row, body.password))) throw invalid;
  return toUser(env, { id: row.id, email: row.email, name: row.name });
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
}

/**
 * Google proves ownership of the e-mail, a password signup does not: linking Google to an
 * existing password account erases the password and every earlier session.
 */
export async function signInWithGoogle(db: D1Database, profile: GoogleProfile): Promise<string> {
  const email = canonicalEmail(profile.email);
  const linked = await db.prepare("SELECT id FROM users WHERE google_sub = ?1").bind(profile.sub).first<{ id: string }>();
  if (linked) return linked.id;
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first<{ id: string }>();
  if (existing) {
    await db.batch([
      db
        .prepare("UPDATE users SET google_sub = ?2, password_hash = NULL, password_salt = NULL WHERE id = ?1")
        .bind(existing.id, profile.sub),
      db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(existing.id),
    ]);
    return existing.id;
  }
  const id = newId();
  await db
    .prepare("INSERT INTO users (id, email, name, google_sub, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(id, email, profile.name?.trim() || email.split("@")[0], profile.sub, nowIso())
    .run();
  return id;
}

interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

function googleCredentials(env: Env): GoogleCredentials | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

const googleRedirectUri = (c: AppContext) => `${new URL(c.req.url).origin}/api/auth/google/callback`;

/**
 * Resolves `next` the way a browser would (tabs and newlines dropped, backslashes read as slashes)
 * and keeps only a path of this origin; a path starting with `//` would leave it on the redirect.
 */
export function safeNextPath(next: string | undefined, origin: string): string {
  const url = next ? URL.parse(next, origin) : null;
  if (!url || url.origin !== origin || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search + url.hash;
}

async function fetchGoogleProfile(c: AppContext, credentials: GoogleCredentials, code: string): Promise<GoogleProfile | null> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: googleRedirectUri(c),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return null;
  const { access_token } = await tokenResponse.json<{ access_token: string }>();
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!profileResponse.ok) return null;
  const profile = await profileResponse.json<GoogleProfile & { email_verified: boolean }>();
  return profile.email_verified ? profile : null;
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/signup", async (c) => {
  const user = await signup(c.env, await readJsonObject(c));
  await startSession(c, user.id);
  return c.json({ user: await userJson(c.env.DB, user) });
});

authRoutes.post("/login", async (c) => {
  const user = await login(c.env, await readJsonObject(c));
  await startSession(c, user.id);
  return c.json({ user: await userJson(c.env.DB, user) });
});

authRoutes.post("/logout", async (c) => {
  await endSession(c);
  return c.body(null, 204);
});

authRoutes.get("/config", (c) => c.json({ googleEnabled: googleCredentials(c.env) !== null }));

authRoutes.get("/google/start", (c) => {
  const credentials = googleCredentials(c.env);
  if (!credentials) throw new ApiError(404, "not_found", "A entrada com Google não está ligada.");
  const state = newToken();
  const cookie = { httpOnly: true, secure: true, sameSite: "Lax", path: OAUTH_COOKIE_PATH, maxAge: 600 } as const;
  setCookie(c, OAUTH_STATE_COOKIE, state, cookie);
  setCookie(c, OAUTH_NEXT_COOKIE, safeNextPath(c.req.query("next"), new URL(c.req.url).origin), cookie);
  const query = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: googleRedirectUri(c),
    response_type: "code",
    scope: "openid email profile",
    state,
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`);
});

authRoutes.get("/google/callback", async (c) => {
  const credentials = googleCredentials(c.env);
  const state = getCookie(c, OAUTH_STATE_COOKIE);
  const next = safeNextPath(getCookie(c, OAUTH_NEXT_COOKIE), new URL(c.req.url).origin);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: OAUTH_COOKIE_PATH, secure: true });
  deleteCookie(c, OAUTH_NEXT_COOKIE, { path: OAUTH_COOKIE_PATH, secure: true });
  const code = c.req.query("code");
  const failure = "/entrar?erro=google";
  if (!credentials || !code || !state || state !== c.req.query("state")) return c.redirect(failure);
  const profile = await fetchGoogleProfile(c, credentials, code);
  if (!profile) return c.redirect(failure);
  await startSession(c, await signInWithGoogle(c.env.DB, profile));
  return c.redirect(next);
});

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get("/me", async (c) => c.json({ user: await userJson(c.env.DB, c.get("user")) }));

accountRoutes.patch("/me", async (c) => {
  const user = c.get("user");
  const name = readText(await readJsonObject(c), "name", 80);
  await c.env.DB.prepare("UPDATE users SET name = ?2 WHERE id = ?1").bind(user.id, name).run();
  return c.json({ user: await userJson(c.env.DB, { ...user, name }) });
});

/** An account without a password (Google only) sets one without proving a current one. */
async function changePassword(c: AppContext, body: Record<string, unknown>): Promise<void> {
  const user = c.get("user");
  const newPassword = readPassword(body, "newPassword");
  const stored = await c.env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?1")
    .bind(user.id)
    .first<StoredPassword>();
  if (stored!.password_hash && !(await passwordMatches(stored!, body.currentPassword))) {
    throw new ApiError(401, "invalid_credentials", "A senha atual não confere.");
  }
  const currentSessionHash = await sessionTokenHash(c.env, getCookie(c, SESSION_COOKIE)!);
  await setPassword(c.env.DB, user.id, newPassword, currentSessionHash);
}

accountRoutes.post("/me/password", async (c) => {
  await changePassword(c, await readJsonObject(c));
  return c.body(null, 204);
});
