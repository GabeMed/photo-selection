// Optional secrets; the required ones are declared in wrangler.jsonc and typed by `wrangler types`.
interface Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
