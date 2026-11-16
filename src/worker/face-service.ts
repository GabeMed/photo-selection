import { DurableObject } from "cloudflare:workers";
import { fromBase64 } from "./db";

const CONTAINER_PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 5 * 60_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;
// The container only answers /health after loading the models, which can take ~90 s on a cold start.
// Each attempt costs the 1 s interval plus up to 2 s of an unanswered /health: the wait gives up after
// 100 s when connections are refused at once, and after 5 minutes when every one of them hangs.
const HEALTH_POLL_ATTEMPTS = 100;
const HEALTH_TIMEOUT_MS = 2_000;
// Below the 5 minutes after which the cron takes a photo in `processando` back.
const ANALYZE_TIMEOUT_MS = 4 * 60_000;

export class FaceService extends DurableObject<Env> {
  private starting?: Promise<boolean>;

  async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container;
    if (!container || !(await this.ensureReady(container))) {
      return new Response("face service unavailable", { status: 503 });
    }
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return container.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }

  /** Starts the container when needed and waits at most `maxWaitMs`; after a false the boot goes on. */
  async isReadyWithin(maxWaitMs: number): Promise<boolean> {
    const container = this.ctx.container;
    if (!container) return false;
    return Promise.race([this.ensureReady(container), scheduler.wait(maxWaitMs).then(() => false)]);
  }

  /** Reports health without starting a stopped container. */
  async probe(): Promise<boolean> {
    const container = this.ctx.container;
    if (!container?.running) return false;
    return (await healthFailure(container)) === undefined;
  }

  private ensureReady(container: Container): Promise<boolean> {
    this.starting ??= startAndWaitForHealth(container).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
}

async function startAndWaitForHealth(container: Container): Promise<boolean> {
  if (!container.running) {
    container.start({ image: container.images.base, instance: "standard-3", enableInternet: false });
  }
  // The timeout is lost whenever the Durable Object restarts, so it is set on every pass.
  await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
  let failure: unknown;
  // A container that died while booting ends the wait; the next call starts it again.
  for (let attempt = 0; attempt < HEALTH_POLL_ATTEMPTS && container.running; attempt++) {
    failure = await healthFailure(container);
    if (failure === undefined) return true;
    await scheduler.wait(HEALTH_POLL_INTERVAL_MS);
  }
  console.error(`face service is not healthy (container running: ${container.running})`, failure);
  return false;
}

/** Why /health did not answer 200, or undefined when it did. */
async function healthFailure(container: Container): Promise<unknown> {
  try {
    const response = await container
      .getTcpPort(CONTAINER_PORT)
      .fetch("http://container/health", { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    await response.body?.cancel();
    return response.ok ? undefined : new Error(`/health answered ${response.status}`);
  } catch (error) {
    // A refused or timed-out connection is the expected answer while the container boots.
    return error;
  }
}

export interface AnalyzedFace {
  box: number[];
  detScore: number;
  embedding: ArrayBuffer;
}

export interface Analysis {
  width: number;
  height: number;
  faces: AnalyzedFace[];
  preview: Uint8Array<ArrayBuffer>;
  thumb: Uint8Array<ArrayBuffer>;
}

interface AnalyzeResponse {
  width: number;
  height: number;
  faces: { box: number[]; det_score: number; embedding_b64: string }[];
  preview_b64: string;
  thumb_b64: string;
}

/** The service answered and refused: 422 for an image it cannot read, anything else for a failed analysis. */
export class FaceServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** No answer about the image: container down or dying (503, broken connection) or over the time limit. */
export class FaceServiceUnavailable extends Error {}

const unavailable = (cause: unknown): never => {
  throw new FaceServiceUnavailable(`face service unavailable: ${cause}`, { cause });
};

const singleton = (env: Env) => env.FACE_SERVICE.getByName("singleton");

/** Starts the container when needed and waits for it; false means "not now". */
export async function isFaceServiceReady(env: Env): Promise<boolean> {
  try {
    const response = await singleton(env).fetch("http://face-service/health");
    await response.body?.cancel();
    return response.ok;
  } catch (error) {
    // Without a Workers Paid plan the container cannot start at all; photos then wait as `recebida`.
    console.error("face service health check failed", error);
    return false;
  }
}

export const isFaceServiceReadyWithin = (env: Env, maxWaitMs: number): Promise<boolean> =>
  singleton(env).isReadyWithin(maxWaitMs);

export const probeFaceService = (env: Env): Promise<boolean> => singleton(env).probe();

async function requestAnalysis(env: Env, image: ReadableStream | ArrayBuffer): Promise<AnalyzeResponse> {
  const signal = AbortSignal.timeout(ANALYZE_TIMEOUT_MS);
  const response = await singleton(env)
    .fetch("http://face-service/analyze", { method: "POST", body: image, signal })
    .catch(unavailable);
  if (response.ok) return response.json<AnalyzeResponse>().catch(unavailable);
  const text = await response.text().catch(unavailable);
  if (response.status === 503) return unavailable(text);
  throw new FaceServiceError(response.status, text);
}

export async function analyzeImage(env: Env, image: ReadableStream | ArrayBuffer): Promise<Analysis> {
  const body = await requestAnalysis(env, image);
  return {
    width: body.width,
    height: body.height,
    faces: body.faces.map((face) => ({
      box: face.box,
      detScore: face.det_score,
      embedding: fromBase64(face.embedding_b64).buffer,
    })),
    preview: fromBase64(body.preview_b64),
    thumb: fromBase64(body.thumb_b64),
  };
}
