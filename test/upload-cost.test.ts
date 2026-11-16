import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/worker/index";
import { api, env, groupWith, json, randomBytes, type ApiInit } from "./helpers";

interface Cost {
  /** Each `run`/`first`/`all`/`raw` call, and each `batch` call, is one round trip to D1. */
  d1RoundTrips: number;
  d1Statements: number;
  r2Operations: string[];
}

const newCost = (): Cost => ({ d1RoundTrips: 0, d1Statements: 0, r2Operations: [] });

const EXECUTING = new Set(["run", "first", "all", "raw"]);

/** The bound native method, so a proxy never stands in for `this` inside the runtime. */
function nativeMember(target: object, property: string | symbol) {
  const value = Reflect.get(target, property);
  return typeof value === "function" ? value.bind(target) : value;
}

function countingDb(db: D1Database, cost: Cost): D1Database {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
        if (typeof property === "string" && EXECUTING.has(property)) {
          cost.d1RoundTrips++;
          cost.d1Statements++;
        }
        return nativeMember(target, property);
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          cost.d1RoundTrips++;
          cost.d1Statements += statements.length;
          return target.batch(statements.map((statement) => originals.get(statement) ?? statement));
        };
      }
      return nativeMember(target, property);
    },
  });
}

function countingBucket(bucket: R2Bucket, cost: Cost): R2Bucket {
  return new Proxy(bucket, {
    get(target, property) {
      const member = nativeMember(target, property);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        cost.r2Operations.push(String(property));
        return member(...args);
      };
    },
  });
}

/** One request to the Worker, with D1 and R2 counted; the same `api` request, sent to the app directly. */
async function measured(path: string, init: ApiInit): Promise<{ response: Response; cost: Cost }> {
  const cost = newCost();
  const counted = { ...env, DB: countingDb(env.DB, cost), BUCKET: countingBucket(env.BUCKET, cost) };
  const headers = new Headers(init.headers);
  if (init.as) headers.set("cookie", init.as.cookie);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  const request = new Request(`https://photos.test${path}`, { method: init.method ?? "POST", headers, body });
  const context = createExecutionContext();
  const response = await worker.fetch(request, counted, context);
  await waitOnExecutionContext(context);
  return { response, cost };
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];

function jpegBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = randomBytes(length);
  bytes.set(JPEG);
  return bytes;
}

describe("server work for one successful upload", () => {
  it("through the upload link", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const link = (await json(api(`/api/groups/${group.id}/upload-link`, { as: ana, method: "POST" }))).uploadLink;
    const bytes = jpegBytes(3000);
    const headers = { "content-length": String(bytes.length), "content-type": "image/jpeg" };
    const { response, cost } = await measured(new URL(link).pathname, { body: bytes, headers });
    await json(response);
    expect(cost).toEqual({ d1RoundTrips: 3, d1Statements: 3, r2Operations: ["put"] });
  });

  it("through the page's slot and PUT, with the declared hash", async () => {
    const { group, friends: [ana] } = await groupWith("Ana");
    const bytes = jpegBytes(3000);
    const slotJson = { filename: "foto.jpg", contentType: "image/jpeg", sizeBytes: bytes.length, contentHash: await sha256Hex(bytes) };
    const slot = await measured(`/api/groups/${group.id}/photos`, { as: ana, json: slotJson });
    const { photo } = await json(slot.response);
    const headers = { "content-length": String(bytes.length) };
    const put = await measured(`/api/photos/${photo.id}/original`, { as: ana, method: "PUT", body: bytes, headers });
    expect((await json(put.response)).photo).toMatchObject({ id: photo.id, status: "recebida" });
    expect(slot.cost).toEqual({ d1RoundTrips: 4, d1Statements: 4, r2Operations: [] });
    expect(put.cost).toEqual({ d1RoundTrips: 4, d1Statements: 4, r2Operations: ["put"] });
  });
});
