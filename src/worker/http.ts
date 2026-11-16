import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };
export type AppContext = Context<AppEnv>;

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The response still waits for the work, and a client that disconnects no longer cancels it.
 * The runtime gets a copy that never rejects: a failure is reported once, through the response.
 */
export function outliveRequest<T>(c: AppContext, work: Promise<T>): Promise<T> {
  c.executionCtx.waitUntil(work.then(
    () => undefined,
    () => undefined,
  ));
  return work;
}

export const notFound = () => new ApiError(404, "not_found", "Não encontrado.");

export const invalidRequest = (message: string) => new ApiError(400, "invalid_request", message);

export async function readJsonObject(c: AppContext): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalidRequest("O corpo do pedido precisa ser um objeto JSON.");
  }
  return body as Record<string, unknown>;
}

export function readText(body: Record<string, unknown>, key: string, maxLength: number): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw invalidRequest(`O campo "${key}" é obrigatório e aceita até ${maxLength} caracteres.`);
  }
  return value.trim();
}

export function readPositiveInteger(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidRequest(`O campo "${key}" precisa ser um número inteiro maior que zero.`);
  }
  return value;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2).replace(".", ",")} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
}
