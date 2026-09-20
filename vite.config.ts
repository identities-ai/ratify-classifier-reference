import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [cloudflare()],
  build: { sourcemap: true },
});
