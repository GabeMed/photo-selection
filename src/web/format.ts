const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** Same wording as the API's own messages: GB with two decimals, otherwise MB with one. */
export function formatBytes(bytes: number): string {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2).replace(".", ",")} GB`;
  return `${(bytes / MIB).toFixed(1).replace(".", ",")} MB`;
}

export const bytesToGb = (bytes: number) => bytes / GIB;

export const gbToBytes = (gb: number) => Math.round(gb * GIB);

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function parseUrl(value: string, base: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    // `new URL` throws on text that is not a URL; `URL.parse` is missing from older iPhones.
    return null;
  }
}

/**
 * Same rule as the Worker's `safeNextPath`: `next` is resolved the way a browser would and only a
 * path of this origin is followed after login; a path starting with `//` would leave it.
 */
export function safeNextPath(next: string | null, origin: string): string {
  const url = next ? parseUrl(next, origin) : null;
  if (!url || url.origin !== origin || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search + url.hash;
}
