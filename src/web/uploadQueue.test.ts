import { describe, expect, it } from "vitest";
import { ApiError, type DuplicatePhoto, type Photo, type PhotoSlotRequest } from "./api";
import { photoOf } from "./testing";
import { createUploadQueue, sha256OfFile, type UploadApi, type UploadQueueState, MAX_HASHED_BYTES } from "./uploadQueue";

interface PutCall {
  uploadUrl: string;
  file: File;
  resolve: (photo: Photo | DuplicatePhoto) => void;
  reject: (error: unknown) => void;
}

const networkError = () => new ApiError(0, "network_error", "Sem conexão.");

interface DoubleOptions {
  /** Files whose slot request answers that the group already has them. */
  duplicates?: string[];
  hashFile?: (file: File) => Promise<string>;
}

/** Stands in for the real hash, which settles later than the queue tests wait. */
const hashOfName = async (file: File) => `hash-${file.name}`;

/** A double of the API: slots are numbered in the order asked, and every PUT waits for the test to settle it. */
function setup(reserveErrors: Record<string, ApiError> = {}, { duplicates = [], hashFile = hashOfName }: DoubleOptions = {}) {
  const reserved: string[] = [];
  const requests: PhotoSlotRequest[] = [];
  const puts: PutCall[] = [];
  const uploaded: (Photo | null)[] = [];
  let state: UploadQueueState = { items: [], stopMessage: null };
  const api: UploadApi = {
    reservePhotoSlot: async (_groupId, request) => {
      requests.push(request);
      if (reserveErrors[request.filename]) throw reserveErrors[request.filename];
      if (duplicates.includes(request.filename)) return { duplicate: true, photoId: `old-${request.filename}` };
      reserved.push(request.filename);
      return { photo: { id: `p${reserved.length}` }, uploadUrl: `/slot/${reserved.length}` };
    },
    uploadOriginal: (uploadUrl, file) => new Promise((resolve, reject) => puts.push({ uploadUrl, file, resolve, reject })),
  };
  const queue = createUploadQueue({ api, hashFile, groupId: "g1", onChange: (next) => (state = next), onUploaded: (photo) => uploaded.push(photo) });
  const statuses = () => Object.fromEntries(state.items.map((item) => [item.file.name, item.status]));
  return { queue, reserved, requests, puts, uploaded, statuses, state: () => state };
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

  it("refuses, for good and without asking for a slot, the placeholder iOS hands over in place of a photo", async () => {
    const { queue, reserved, puts, statuses, state } = setup();
    const placeholder = new File(["bplist00".padEnd(135, "x")], "quebrada", { type: "image/heic" });
    const smallPhoto = new File(["x".repeat(135)], "pequena", { type: "image/jpeg" });
    queue.add([placeholder, smallPhoto]);
    await settle();
    expect(statuses()).toEqual({ quebrada: "failed", pequena: "uploading" });
    expect(reserved).toEqual(["pequena"]);
    expect(puts.map((put) => put.file.name)).toEqual(["pequena"]);
    expect(state().items[0]).toMatchObject({ retryable: false, message: "O iPhone não entregou essa foto. Escolhe ela de novo, num lote menor." });
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

  it("marks a file the group already has as duplicate, apart from failures, without sending it or offering a retry", async () => {
    const { queue, puts, uploaded, statuses } = setup({}, { duplicates: ["b"] });
    queue.add(filesNamed("a", "b", "c"));
    await settle();
    expect(statuses()).toEqual({ a: "uploading", b: "duplicate", c: "uploading" });
    expect(puts.map((put) => put.file.name)).toEqual(["a", "c"]);

    puts[0].resolve(photoOf({ id: "p1" }));
    puts[1].resolve({ duplicate: true, photoId: "p1" });
    await settle();
    expect(statuses()).toEqual({ a: "done", b: "duplicate", c: "duplicate" });
    expect(uploaded).toEqual([photoOf({ id: "p1" })]);

    queue.retry();
    await settle();
    expect(statuses()).toEqual({ a: "done", b: "duplicate", c: "duplicate" });
    expect(puts).toHaveLength(2);
  });

  it("declares the hash of each file, hashing only the files about to be sent", async () => {
    const hashed: string[] = [];
    const { queue, requests } = setup({}, { hashFile: (file) => (hashed.push(file.name), hashOfName(file)) });
    queue.add(filesNamed("a", "b", "c", "d", "e"));
    await settle();
    expect(hashed).toEqual(["a", "b", "c"]);
    expect(requests.map((request) => request.contentHash)).toEqual(["hash-a", "hash-b", "hash-c"]);
  });

  it("hashes a file as SHA-256 in lowercase hex", async () => {
    expect(await sha256OfFile(new File(["bytes"], "a"))).toBe("277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9");
  });

  it("does not read a very large file to hash it", async () => {
    const hashed: string[] = [];
    const { queue, requests } = setup({}, { hashFile: (file) => (hashed.push(file.name), hashOfName(file)) });
    const [large, small] = filesNamed("grande", "pequena");
    Object.defineProperty(large, "size", { value: MAX_HASHED_BYTES + 1 });
    queue.add([large, small]);
    await settle();
    expect(hashed).toEqual(["pequena"]);
    expect(requests.map((request) => request.contentHash)).toEqual([undefined, "hash-pequena"]);
  });

  it("sends the file without a hash when hashing fails", async () => {
    const { queue, requests, puts, statuses } = setup({}, { hashFile: () => Promise.reject(new RangeError("Out of memory")) });
    queue.add(filesNamed("a"));
    await settle();
    expect(requests).toEqual([{ filename: "a", contentType: "image/jpeg", sizeBytes: 5, contentHash: undefined }]);
    expect(puts.map((put) => put.file.name)).toEqual(["a"]);

    puts[0].resolve(photoOf({ id: "p1" }));
    await settle();
    expect(statuses()).toEqual({ a: "done" });
  });
});
