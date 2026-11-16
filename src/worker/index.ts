import { Hono } from "hono";
import { adminRoutes } from "./admin";
import { accountRoutes, authRoutes, requireAdmin, requireUser } from "./auth";
import { groupRoutes } from "./groups";
import { ApiError, type AppEnv } from "./http";
import { photoRoutes } from "./photos";
import { drain } from "./processing";
import { selfieRoutes } from "./selfies";
import { tokenUploadRoutes, uploadLinkRoutes } from "./upload-link";

export { FaceService } from "./face-service";

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  console.error(error);
  return c.json({ error: { code: "internal_error", message: "Erro interno. Tente de novo." } }, 500);
});

app.notFound((c) => c.json({ error: { code: "not_found", message: "Não encontrado." } }, 404));

// Registered before the session gate: these are the only routes open without a session.
app.route("/api/auth", authRoutes);
app.route("/api/u", tokenUploadRoutes);

app.use("/api/*", requireUser);
app.route("/api", accountRoutes);
app.route("/api", selfieRoutes);
app.route("/api", groupRoutes);
app.route("/api", photoRoutes);
app.route("/api", uploadLinkRoutes);

app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", adminRoutes);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    await drain(env);
  },
} satisfies ExportedHandler<Env>;
