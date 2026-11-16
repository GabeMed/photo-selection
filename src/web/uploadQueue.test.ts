import { describe, expect, it } from "vitest";
import { ApiError, type Photo } from "./api";
import { photoOf } from "./testing";
import { createUploadQueue, type UploadApi, type UploadQueueState } from "./uploadQueue";

interface PutCall {
  uploadUrl: string;
  file: File;
  resolve: (photo: Photo) => void;
  reject: (error: unknown) => void;
}

const networkError = () => new ApiError(0, "network_error", "Sem conexão.");

/** A double of the API: slots are numbered in the order asked, and every PUT waits for the test to settle it. */
function setup(reserveErrors: Record<string, ApiError> = {}) {
  const reserved: string[] = [];
  const puts: PutCall[] = [];
  const uploaded: (Photo | null)[] = [];
  let state: UploadQueueState = { items: [], stopMessage: null };
  const api: UploadApi = {
    reservePhotoSlot: async (_groupId, request) => {
      if (reserveErrors[request.filename]) throw reserveErrors[request.filename];
      reserved.push(request.filename);
      return { photo: { id: `p${reserved.length}` }, uploadUrl: `/slot/${reserved.length}` };
    },
    uploadOriginal: (uploadUrl, file) => new Promise((resolve, reject) => puts.push({ uploadUrl, file, resolve, reject })),
  };
  const queue = createUploadQueue({ api, groupId: "g1", onChange: (next) => (state = next), onUploaded: (photo) => uploaded.push(photo) });
  const statuses = () => Object.fromEntries(state.items.map((item) => [item.file.name, item.status]));
  return { queue, reserved, puts, uploaded, statuses, state: () => state };
}

const filesNamed = (...names: string[]) => names.map((name) => new File(["bytes"], name, { type: "image/jpeg" }));

/** Lets the queue's promise chains run up to their next wait on the API double. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("upload queue", () => {
  it("sends three files at a time and starts the next as one ends", async () => {
    const { queue, puts, statuses } = setup();
    queue.add(filesNamed("a", "b", "c", "d", "e"));
    await settle();
    expect(puts.map((put) => put.file.name)).toEqual(["a", "b", "c"]);
    expect(statuses()).toEqual({ a: "uploading", b: "uploading", c: "uploading", d: "queued", e: "queued" });

    puts[1].resolve(photoOf({ id: "p2" }));
    await settle();
    expect(puts.map((put) => put.file.name)).toEqual(["a", "b", "c", "d"]);
    expect(statuses()).toEqual({ a: "uploading", b: "done", c: "uploading", d: "uploading", e: "queued" });
  });

  it("hands the upload the very File it received, not a copy", async () => {
    const { queue, puts, uploaded } = setup();
    const [file] = filesNamed("a");
    queue.add([file]);
    await settle();
    expect(puts[0].file).toBe(file);

    const photo = photoOf({ id: "p1" });
    puts[0].resolve(photo);
    await settle();
    expect(uploaded).toEqual([photo]);
  });

  it("stops the batch at a quota refusal, letting the files already in flight finish", async () => {
    const quota = new ApiError(409, "group_quota_exceeded", "O grupo está cheio.");
    const { queue, puts, statuses, state, reserved } = setup({ c: quota });
    queue.add(filesNamed("a", "b", "c", "d", "e"));
    await settle();
    expect(statuses()).toEqual({ a: "uploading", b: "uploading", c: "failed", d: "skipped", e: "skipped" });
    expect(state().stopMessage).toBe("O grupo está cheio.");

    puts[0].resolve(photoOf({ id: "p1" }));
    puts[1].resolve(photoOf({ id: "p2" }));
    await settle();
    expect(statuses()).toEqual({ a: "done", b: "done", c: "failed", d: "skipped", e: "skipped" });
    expect(reserved).toEqual(["a", "b"]);
  });

  it("refuses only the file of a type the site does not accept, for good", async () => {
    const { queue, puts, statuses, state } = setup({ b: new ApiError(415, "unsupported_type", "Formato não aceito.") });
    queue.add(filesNamed("a", "b", "c"));
    await settle();
    expect(statuses()).toEqual({ a: "uploading", b: "failed", c: "uploading" });
    expect(state().stopMessage).toBeNull();
    expect(state().items[1]).toMatchObject({ message: "Formato não aceito.", retryable: false });

    puts.forEach((put, index) => put.resolve(photoOf({ id: `p${index}` })));
    await settle();
    queue.retry();
    await settle();
    expect(statuses()).toEqual({ a: "done", b: "failed", c: "done" });
  });

  it("treats a slot request the API calls invalid as a refusal of the file, in friendly words", async () => {
    const { queue, state } = setup({ a: new ApiError(400, "invalid_request", 'O campo "contentType" é obrigatório.') });
    queue.add(filesNamed("a"));
    await settle();
    expect(state().items[0]).toMatchObject({ status: "failed", retryable: false, message: "Este arquivo não é uma foto que o site aceita." });
  });

  it("sends again to the same slot, and takes 409 not_uploading as bytes that had arrived", async () => {
    const { queue, puts, reserved, uploaded, statuses, state } = setup();
    queue.add(filesNamed("a"));
    await settle();
    puts[0].reject(networkError());
    await settle();
    expect(state().items[0]).toMatchObject({ status: "failed", retryable: true, uploadUrl: "/slot/1" });

    queue.retry();
    await settle();
    expect(puts[1].uploadUrl).toBe("/slot/1");
    puts[1].reject(new ApiError(409, "not_uploading", "Essa foto não está aguardando envio."));
    await settle();
    expect(statuses()).toEqual({ a: "done" });
    expect(reserved).toEqual(["a"]);
    expect(uploaded).toEqual([null]);
  });

  it("asks for another slot when the earlier one answers 404", async () => {
    const { queue, puts, reserved, uploaded, statuses } = setup();
    queue.add(filesNamed("a"));
    await settle();
    puts[0].reject(networkError());
    await settle();

    queue.retry();
    await settle();
    puts[1].reject(new ApiError(404, "not_found", "Não encontrado."));
    await settle();
    expect(puts.map((put) => put.uploadUrl)).toEqual(["/slot/1", "/slot/1", "/slot/2"]);
    expect(reserved).toEqual(["a", "a"]);

    const photo = photoOf({ id: "p2" });
    puts[2].resolve(photo);
    await settle();
    expect(statuses()).toEqual({ a: "done" });
    expect(uploaded).toEqual([photo]);
  });

  it("fails the item, open to another attempt, on an error that is not from the API", async () => {
    const { queue, puts, state } = setup();
    queue.add(filesNamed("a", "b"));
    await settle();
    puts[0].reject(new TypeError("boom"));
    await settle();
    expect(state().items[0]).toMatchObject({ status: "failed", retryable: true });
    expect(state().items[1].status).toBe("uploading");
  });
});
