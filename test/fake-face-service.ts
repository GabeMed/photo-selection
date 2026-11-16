import { DurableObject } from "cloudflare:workers";

/** A face is a seed (one-hot unit vector) or a list of seeds (their normalised sum). */
export type FakeFace = number | number[];

export interface FakeScript {
  faces?: FakeFace[];
  /** Box height of each face, as a share of the image; 0.2 where absent. */
  heights?: number[];
  delayMs?: number;
  status?: number;
}

const SCRIPT_PREFIX = "FAKE ";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bytes the double understands: one script line, then arbitrary payload. */
export function scriptedImage(script: FakeScript, payload: Uint8Array = new Uint8Array()): Uint8Array<ArrayBuffer> {
  const header = encoder.encode(`${SCRIPT_PREFIX}${JSON.stringify(script)}\n`);
  const image = new Uint8Array(header.length + payload.length);
  image.set(header);
  image.set(payload, header.length);
  return image;
}

function readScript(image: Uint8Array): FakeScript {
  const lineEnd = image.indexOf(10);
  const line = decoder.decode(image.subarray(0, Math.max(lineEnd, 0)));
  return line.startsWith(SCRIPT_PREFIX) ? (JSON.parse(line.slice(SCRIPT_PREFIX.length)) as FakeScript) : {};
}

function embeddingBase64(face: FakeFace): string {
  const seeds = [face].flat();
  const vector = new Float32Array(512);
  for (const seed of seeds) vector[seed] = 1 / Math.sqrt(seeds.length);
  return btoa(String.fromCharCode(...new Uint8Array(vector.buffer)));
}

/** Stands in for the container: deterministic faces and vectors, scripted by the image bytes. */
export class FakeFaceService extends DurableObject {
  private healthy = true;
  private nextDelayMs = 0;
  private readyWaitMs: number | null = null;
  private crashNext = false;

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  probe(): boolean {
    return this.healthy;
  }

  isReadyWithin(maxWaitMs: number): boolean {
    this.readyWaitMs = maxWaitMs;
    return this.healthy;
  }

  lastReadyWaitMs(): number | null {
    return this.readyWaitMs;
  }

  /** Delays only the next analysis, so one attempt can be made slower than the one after it. */
  delayNextAnalysis(delayMs: number): void {
    this.nextDelayMs = delayMs;
  }

  /** The next analysis ends like a container that died with the request in flight. */
  crashNextAnalysis(): void {
    this.crashNext = true;
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.healthy) return new Response("face service unavailable", { status: 503 });
    if (new URL(request.url).pathname === "/health") return Response.json({ status: "ok" });
    if (this.crashNext) {
      this.crashNext = false;
      throw new Error("Network connection lost.");
    }
    const image = new Uint8Array(await request.arrayBuffer());
    const script = readScript(image);
    const delayMs = this.nextDelayMs || script.delayMs;
    this.nextDelayMs = 0;
    if (delayMs) await scheduler.wait(delayMs);
    if (script.status) return Response.json({ error: "scripted failure" }, { status: script.status });
    return Response.json({
      width: 4000,
      height: 3000,
      faces: (script.faces ?? []).map((face, index) => ({
        box: [0.1, 0.1, 0.2, script.heights?.[index] ?? 0.2],
        det_score: 0.9,
        embedding_b64: embeddingBase64(face),
      })),
      preview_b64: btoa(`preview of ${image.length} bytes`),
      thumb_b64: btoa("thumb"),
    });
  }
}
