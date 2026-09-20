import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: {
      bindings: {
        ALLOW_LOCAL_DEV: "true",
        CLASSIFIER_API_KEY: "test-classifier-key",
        LABS_ROUTER_TOKEN: "test-router-token-with-at-least-32-bytes",
        PRIVACY_SALT: "test-privacy-salt-with-at-least-32-bytes",
      },
    },
  })],
  test: {
    globals: false,
  },
});
