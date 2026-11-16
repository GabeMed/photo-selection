export type PhotoStatus = "enviando" | "recebida" | "processando" | "processada" | "falhou";
export type PhotoTag = "me" | "not_me";
export type PhotoFilter = "all" | "mine" | `user:${string}`;

export interface Photo {
  id: string;
  groupId: string;
  uploaderId: string;
  uploaderName: string;
  filename: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: PhotoStatus;
  createdAt: string;
  thumbUrl: string | null;
  previewUrl: string | null;
  originalUrl: string;
  mine: boolean;
  myTag: PhotoTag | null;
  canDelete: boolean;
}

export interface Selfie {
  id: string;
  url: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  /** False for an account that only signs in with Google. */
  hasPassword: boolean;
  selfies: Selfie[];
}

export interface GroupCounts {
  total: number;
  processing: number;
  failed: number;
}

export interface GroupSummary {
  id: string;
  name: string;
  memberCount: number;
  photoCount: number;
  usedBytes: number;
  quotaBytes: number;
  myPhotoCount: number;
}

export interface Member {
  id: string;
  name: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  inviteToken: string;
  usedBytes: number;
  quotaBytes: number;
  members: Member[];
  counts: GroupCounts;
}

export interface InvitedGroup {
  id: string;
  name: string;
  memberCount: number;
}

export interface Invite {
  group: InvitedGroup;
  alreadyMember: boolean;
}

export interface PhotoPage {
  photos: Photo[];
  nextCursor: string | null;
}

export interface MyPhotosGroup {
  id: string;
  name: string;
  photos: Photo[];
}

export interface PhotoSlot {
  photo: { id: string };
  uploadUrl: string;
}

export interface AdminSettings {
  maxGroups: number;
  defaultGroupQuotaBytes: number;
  userMonthlyQuotaBytes: number;
  matchThreshold: number;
}

export interface AdminGroup {
  id: string;
  name: string;
  inviteToken: string;
  memberCount: number;
  photoCount: number;
  usedBytes: number;
  quotaBytes: number;
  counts: GroupCounts;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  monthUsedBytes: number;
}

export interface AdminOverview {
  settings: AdminSettings;
  totalUsedBytes: number;
  groups: AdminGroup[];
  users: AdminUser[];
  faceService: { healthy: boolean };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const networkError = () => new ApiError(0, "network_error", "Sem conexão com o site. Confira a internet e tente de novo.");

const stalledUpload = () => new ApiError(0, "upload_stalled", "O envio parou de avançar. Confira a internet e tente de novo.");

const interruptedDownload = () => new ApiError(0, "download_interrupted", "O download foi interrompido no meio. Tente de novo.");

const unreadableResponse = (status: number) => new ApiError(status, "unknown", "Algo deu errado. Tente de novo.");

export const loginPath = (next: string) => `/entrar?next=${encodeURIComponent(next)}`;

function toApiError(status: number, bodyText: string): ApiError {
  const fallback = unreadableResponse(status);
  try {
    const { error } = JSON.parse(bodyText) as { error?: { code: string; message: string } };
    return error ? new ApiError(status, error.code, error.message) : fallback;
  } catch {
    // A proxy in front of the Worker can answer with a body that is not the API's JSON.
    return fallback;
  }
}

/** The single place a failed response becomes an error; a lost session leaves for the login page. */
function rejectResponse(status: number, bodyText: string): Promise<never> {
  const error = toApiError(status, bodyText);
  if (error.code !== "unauthorized") return Promise.reject(error);
  window.location.assign(loginPath(window.location.pathname + window.location.search));
  // The page is being replaced: staying pending keeps the caller from flashing an error first.
  return new Promise<never>(() => {});
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, init).catch(() => {
    throw networkError();
  });
  if (response.ok) return response;
  return rejectResponse(response.status, await response.text());
}

async function getJson<T>(path: string): Promise<T> {
  return (await send(path)).json() as Promise<T>;
}

function sendJson(method: string, path: string, body?: unknown): Promise<Response> {
  if (body === undefined) return send(path, { method });
  return send(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function sendJsonFor<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await sendJson(method, path, body)).json() as Promise<T>;
}

// ---- Account ----

export const getAuthConfig = () => getJson<{ googleEnabled: boolean }>("/api/auth/config");

export const googleStartUrl = (next: string) => `/api/auth/google/start?next=${encodeURIComponent(next)}`;

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  setupCode?: string;
}

export const signup = async (request: SignupRequest) =>
  (await sendJsonFor<{ user: User }>("POST", "/api/auth/signup", request)).user;

export const login = async (email: string, password: string) =>
  (await sendJsonFor<{ user: User }>("POST", "/api/auth/login", { email, password })).user;

export const logout = async () => void (await sendJson("POST", "/api/auth/logout"));

export const getMe = async () => (await getJson<{ user: User }>("/api/me")).user;

/** `currentPassword` is left out by an account that has no password yet. */
export const changePassword = async (newPassword: string, currentPassword?: string) =>
  void (await sendJson("POST", "/api/me/password", { currentPassword, newPassword }));

export const updateName = async (name: string) => (await sendJsonFor<{ user: User }>("PATCH", "/api/me", { name })).user;

export async function addSelfie(image: File): Promise<Selfie> {
  const response = await send("/api/me/selfies", { method: "POST", headers: { "content-type": image.type }, body: image });
  return ((await response.json()) as { selfie: Selfie }).selfie;
}

export const removeSelfie = async (selfieId: string) => void (await sendJson("DELETE", `/api/me/selfies/${selfieId}`));

// ---- Groups ----

export const listGroups = async () => (await getJson<{ groups: GroupSummary[] }>("/api/groups")).groups;

export const getGroup = async (groupId: string) => (await getJson<{ group: GroupDetail }>(`/api/groups/${groupId}`)).group;

export const getInvite = (token: string) => getJson<Invite>(`/api/invites/${token}`);

export const joinInvite = async (token: string) =>
  (await sendJsonFor<{ group: InvitedGroup }>("POST", `/api/invites/${token}/join`)).group;

// ---- Photos ----

export function listGroupPhotos(groupId: string, filter: PhotoFilter, cursor?: string): Promise<PhotoPage> {
  const query = new URLSearchParams({ filter });
  if (cursor) query.set("cursor", cursor);
  return getJson<PhotoPage>(`/api/groups/${groupId}/photos?${query}`);
}

export const listMyPhotos = async () => (await getJson<{ groups: MyPhotosGroup[] }>("/api/me/photos")).groups;

export interface PhotoSlotRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export const reservePhotoSlot = (groupId: string, request: PhotoSlotRequest) =>
  sendJsonFor<PhotoSlot>("POST", `/api/groups/${groupId}/photos`, request);

export const UPLOAD_STALL_TIMEOUT_MS = 60_000;

/** Async so that a body that cannot be read becomes a rejection the upload promise adopts. */
async function parseUploadedPhoto(status: number, bodyText: string): Promise<Photo> {
  try {
    return (JSON.parse(bodyText) as { photo: Photo }).photo;
  } catch {
    // A proxy in front of the Worker can answer 200 with a body that is not the API's JSON.
    throw unreadableResponse(status);
  }
}

/**
 * Sends the file itself as the body, untouched. XMLHttpRequest because fetch reports no upload progress.
 * A request that makes no progress for UPLOAD_STALL_TIMEOUT_MS is aborted, so it always settles.
 */
export function uploadOriginal(uploadUrl: string, file: File, onProgress: (sentBytes: number) => void): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const restartStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => xhr.abort(), UPLOAD_STALL_TIMEOUT_MS);
    };
    xhr.open("PUT", uploadUrl);
    xhr.upload.onprogress = (event) => {
      restartStallTimer();
      onProgress(event.loaded);
    };
    xhr.onerror = () => reject(networkError());
    xhr.ontimeout = () => reject(stalledUpload());
    xhr.onabort = () => reject(stalledUpload());
    xhr.onload = () => {
      if (xhr.status !== 200) return resolve(rejectResponse(xhr.status, xhr.responseText));
      resolve(parseUploadedPhoto(xhr.status, xhr.responseText));
    };
    xhr.onloadend = () => clearTimeout(stallTimer);
    restartStallTimer();
    xhr.send(file);
  });
}

export const setPhotoTag = async (photoId: string, value: PhotoTag | null) =>
  (await sendJsonFor<{ photo: Photo }>("PUT", `/api/photos/${photoId}/tag`, { value })).photo;

export const deletePhoto = async (photoId: string) => void (await sendJson("DELETE", `/api/photos/${photoId}`));

/** The headers arrive before the bytes: a connection lost in the middle of the body fails here. */
const readBlob = (response: Response) =>
  response.blob().catch(() => {
    throw interruptedDownload();
  });

export const downloadOriginal = async (photo: Photo) => readBlob(await send(photo.originalUrl));

export const downloadZip = async (groupId: string, photoIds: string[]) =>
  readBlob(await sendJson("POST", `/api/groups/${groupId}/download`, { photoIds }));

// ---- Administration ----

export const getAdminOverview = () => getJson<AdminOverview>("/api/admin/overview");

export const updateSettings = async (settings: AdminSettings) =>
  (await sendJsonFor<{ settings: AdminSettings }>("PATCH", "/api/admin/settings", settings)).settings;

export const createGroup = async (name: string, quotaBytes?: number) =>
  (await sendJsonFor<{ group: AdminGroup }>("POST", "/api/admin/groups", { name, quotaBytes })).group;

export const updateGroupQuota = async (groupId: string, quotaBytes: number) =>
  (await sendJsonFor<{ group: AdminGroup }>("PATCH", `/api/admin/groups/${groupId}`, { quotaBytes })).group;

export const resetPassword = async (userId: string) =>
  (await sendJsonFor<{ temporaryPassword: string }>("POST", `/api/admin/users/${userId}/reset-password`)).temporaryPassword;

export const reprocessPhoto = async (photoId: string) => void (await sendJson("POST", `/api/admin/photos/${photoId}/reprocess`));
