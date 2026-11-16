import { ApiError, isDuplicate, type DuplicatePhoto, type Photo, type PhotoSlot, type PhotoSlotRequest } from "./api";

/** `duplicate`: the group already had the same file, so it was not sent again. Not a failure. */
export type UploadStatus = "queued" | "uploading" | "done" | "duplicate" | "failed" | "skipped";

export interface UploadItem {
  key: number;
  file: File;
  status: UploadStatus;
  sentBytes: number;
  message: string | null;
  retryable: boolean;
  /** The slot reserved by an attempt that did not finish; the next attempt sends to it again. */
  uploadUrl: string | null;
}

export interface UploadQueueState {
  items: UploadItem[];
  /** Set when a quota refusal stopped the batch. */
  stopMessage: string | null;
}

/** The two API calls of an upload; a parameter so the queue runs against a double in tests. */
export interface UploadApi {
  reservePhotoSlot: (groupId: string, request: PhotoSlotRequest) => Promise<PhotoSlot | DuplicatePhoto>;
  uploadOriginal: (uploadUrl: string, file: File, onProgress: (sentBytes: number) => void) => Promise<Photo | DuplicatePhoto>;
}

export interface UploadQueueOptions {
  api: UploadApi;
  /** SHA-256 of the file in lowercase hex; a parameter so tests can make it fail. */
  hashFile: (file: File) => Promise<string>;
  groupId: string;
  onChange: (state: UploadQueueState) => void;
  /** `null` when the bytes had arrived in an earlier attempt whose answer was lost. */
  onUploaded: (photo: Photo | null) => void;
}

export interface UploadQueue {
  add: (files: File[]) => void;
  retry: () => void;
  clear: () => void;
}

const CONCURRENCY = 3;
export const PROGRESS_INTERVAL_MS = 250;
/** Every later file would hit the same limit, so the batch stops. */
const BATCH_STOPPING_CODES = new Set(["group_quota_exceeded", "user_quota_exceeded"]);
/** The file itself is refused; sending it again cannot work. */
const FILE_REFUSED_CODES = new Set(["file_too_large", "unsupported_type", "invalid_request", "not_delivered"]);
/** Replaces API messages that describe the request instead of the file. */
const FRIENDLY_MESSAGES: Record<string, string> = { invalid_request: "Este arquivo não é uma foto que o site aceita." };
const UNEXPECTED_MESSAGE = "Algo deu errado neste envio. Tente de novo.";

// Some browsers leave `type` empty for HEIC files; the API needs the real type to accept them.
const TYPE_BY_EXTENSION: Record<string, string> = { heic: "image/heic", heif: "image/heif" };

function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()!.toLowerCase();
  return TYPE_BY_EXTENSION[extension] ?? "";
}

/**
 * In a large selection the iOS photo picker hands some photos over as a 135-byte property list
 * instead of the image (WebKit bugs 256711 and 272996). The File is all the page has, so sending
 * again cannot work: the person has to pick the photo again.
 */
const PLACEHOLDER_SIGNATURE = "bplist00";
const PLACEHOLDER_MAX_BYTES = 1024;
export const MAX_HASHED_BYTES = 32 * 1024 * 1024;

async function assertDelivered(file: File): Promise<void> {
  if (file.size > PLACEHOLDER_MAX_BYTES) return;
  if ((await file.slice(0, PLACEHOLDER_SIGNATURE.length).text()) !== PLACEHOLDER_SIGNATURE) return;
  throw new ApiError(0, "not_delivered", "O iPhone não entregou essa foto. Escolhe ela de novo, num lote menor.");
}

export async function sha256OfFile(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const isWaitingForRetry = (item: UploadItem) => item.status === "skipped" || (item.status === "failed" && item.retryable);

export function createUploadQueue({ api, hashFile, groupId, onChange, onUploaded }: UploadQueueOptions): UploadQueue {
  let items: UploadItem[] = [];
  let stopMessage: string | null = null;
  let active = 0;
  let nextKey = 0;
  let lastProgressEmit = 0;

  const emit = () => onChange({ items, stopMessage });
  const set = (key: number, change: Partial<UploadItem>) => {
    items = items.map((item) => (item.key === key ? { ...item, ...change } : item));
  };
  const patch = (key: number, change: Partial<UploadItem>) => {
    set(key, change);
    emit();
  };
  /** Progress events come many times a second; the screen hears about them a few times a second. */
  const reportProgress = (key: number, sentBytes: number) => {
    set(key, { sentBytes });
    if (Date.now() - lastProgressEmit < PROGRESS_INTERVAL_MS) return;
    lastProgressEmit = Date.now();
    emit();
  };

  const stopBatch = (message: string) => {
    stopMessage = message;
    items = items.map((item) => (item.status === "queued" ? { ...item, status: "skipped" } : item));
    emit();
  };

  const fail = (key: number, error: unknown) => {
    if (!(error instanceof ApiError)) {
      // A bug, not a refusal: it is reported, and the item still leaves "uploading" so the batch ends.
      console.error(error);
      return patch(key, { status: "failed", message: UNEXPECTED_MESSAGE, retryable: true });
    }
    const message = FRIENDLY_MESSAGES[error.code] ?? error.message;
    patch(key, { status: "failed", message, retryable: !FILE_REFUSED_CODES.has(error.code) });
    if (BATCH_STOPPING_CODES.has(error.code)) stopBatch(error.message);
  };

  /** Without a hash the server still finds the duplicate, only after the bytes arrive. */
  const hashOrNothing = async (file: File) => {
    // Hashing reads the whole file into memory, and a phone's tab dies without an exception when that
    // runs out. The server finds duplicates on arrival anyway.
    if (file.size > MAX_HASHED_BYTES) return undefined;
    try {
      return await hashFile(file);
    } catch (error) {
      // Reading a large file can run out of memory, and some browsers lack crypto.subtle outside HTTPS.
      console.warn("sending without a content hash", error);
      return undefined;
    }
  };

  /** Hashed right before its own slot request, so only the files in flight are ever read into memory. */
  const sendToNewSlot = async ({ key, file }: UploadItem) => {
    await assertDelivered(file);
    const contentHash = await hashOrNothing(file);
    const slot = await api.reservePhotoSlot(groupId, { filename: file.name, contentType: contentTypeOf(file), sizeBytes: file.size, contentHash });
    if (isDuplicate(slot)) return slot;
    set(key, { uploadUrl: slot.uploadUrl });
    return api.uploadOriginal(slot.uploadUrl, file, (sentBytes) => reportProgress(key, sentBytes));
  };

  /** Sending again to the slot of the earlier attempt keeps the quota from being charged twice. */
  const sendToReservedSlot = async (item: UploadItem, uploadUrl: string) => {
    try {
      return await api.uploadOriginal(uploadUrl, item.file, (sentBytes) => reportProgress(item.key, sentBytes));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      // The bytes arrived in the earlier attempt and only its answer was lost.
      if (error.code === "not_uploading") return null;
      // The server removed the abandoned slot.
      if (error.status === 404) return sendToNewSlot(item);
      throw error;
    }
  };

  const upload = async (item: UploadItem) => {
    const photo = await (item.uploadUrl ? sendToReservedSlot(item, item.uploadUrl) : sendToNewSlot(item));
    if (photo && isDuplicate(photo)) return patch(item.key, { status: "duplicate", sentBytes: item.file.size, uploadUrl: null });
    patch(item.key, { status: "done", sentBytes: item.file.size, uploadUrl: null });
    onUploaded(photo);
  };

  const pump = () => {
    while (active < CONCURRENCY) {
      const next = items.find((item) => item.status === "queued");
      if (!next) return;
      active += 1;
      patch(next.key, { status: "uploading", sentBytes: 0, message: null });
      void upload(next)
        .catch((error: unknown) => fail(next.key, error))
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  const add = (files: File[]) => {
    const added = files.map<UploadItem>((file) => ({
      key: nextKey++,
      file,
      status: "queued",
      sentBytes: 0,
      message: null,
      retryable: true,
      uploadUrl: null,
    }));
    items = [...items, ...added];
    emit();
    pump();
  };

  const retry = () => {
    stopMessage = null;
    items = items.map((item) => (isWaitingForRetry(item) ? { ...item, status: "queued" } : item));
    emit();
    pump();
  };

  const clear = () => {
    stopMessage = null;
    items = [];
    emit();
  };

  return { add, retry, clear };
}
