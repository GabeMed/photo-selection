import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadZip, UPLOAD_STALL_TIMEOUT_MS, uploadOriginal } from "./api";
import { photoOf } from "./testing";

/** The part of XMLHttpRequest the upload uses; the test plays the network by calling the handlers. */
class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress?: (event: { loaded: number }) => void } = {};
  onerror?: () => void;
  onabort?: () => void;
  ontimeout?: () => void;
  onload?: () => void;
  onloadend?: () => void;
  status = 0;
  responseText = "";
  sent: unknown;
  constructor() {
    FakeXhr.last = this;
  }
  open() {}
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.onabort?.();
    this.onloadend?.();
  }
  answer(status: number, responseText: string) {
    Object.assign(this, { status, responseText });
    this.onload?.();
    this.onloadend?.();
  }
}

const file = new File(["bytes"], "a.jpg", { type: "image/jpeg" });

describe("uploadOriginal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the File itself as the body and answers with the photo", async () => {
    const photo = photoOf({ id: "p1" });
    const upload = uploadOriginal("/slot/1", file, () => {});
    expect(FakeXhr.last.sent).toBe(file);
    FakeXhr.last.answer(200, JSON.stringify({ photo }));
    expect(await upload).toEqual(photo);
  });

  it("aborts an upload that makes no progress for the stall timeout, counted from the last progress", async () => {
    const progress: number[] = [];
    const upload = uploadOriginal("/slot/1", file, (sentBytes) => progress.push(sentBytes));
    const outcome = upload.catch((error: unknown) => error);

    vi.advanceTimersByTime(UPLOAD_STALL_TIMEOUT_MS - 1);
    FakeXhr.last.upload.onprogress!({ loaded: 3 });
    vi.advanceTimersByTime(UPLOAD_STALL_TIMEOUT_MS - 1);
    expect(await Promise.race([outcome, "pending"])).toBe("pending");

    vi.advanceTimersByTime(1);
    expect(await outcome).toMatchObject({ code: "upload_stalled" });
    expect(progress).toEqual([3]);
  });

  it("rejects with an API error when a 200 answer is not the API's JSON", async () => {
    const upload = uploadOriginal("/slot/1", file, () => {});
    FakeXhr.last.answer(200, "<html>proxy</html>");
    await expect(upload).rejects.toMatchObject({ code: "unknown", status: 200 });
  });

  it("rejects with the API's refusal on another status", async () => {
    const upload = uploadOriginal("/slot/1", file, () => {});
    FakeXhr.last.answer(409, JSON.stringify({ error: { code: "not_uploading", message: "Essa foto não está aguardando envio." } }));
    await expect(upload).rejects.toMatchObject({ code: "not_uploading", status: 409 });
  });
});

describe("downloadZip", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns a body that breaks in the middle into an API error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
        controller.error(new TypeError("network error"));
      },
    });
    vi.stubGlobal("fetch", async () => new Response(body, { status: 200 }));
    await expect(downloadZip("g1", ["p1"])).rejects.toMatchObject({ code: "download_interrupted" });
  });
});
