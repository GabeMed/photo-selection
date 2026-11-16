import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            main: "./test/worker.ts",
            wrangler: { configPath: "./test/wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                ADMIN_EMAIL: "Admin@Example.com",
                ADMIN_SETUP_CODE: "test-setup-code",
                SESSION_SECRET: "test-session-secret",
              },
            },
          }),
        ],
        test: { name: "worker", include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
      },
      // The frontend's logic that needs no browser runs in plain Node, outside the Workers runtime.
      { test: { name: "web", include: ["src/web/**/*.test.ts"], environment: "node" } },
    ],
  },
}));
