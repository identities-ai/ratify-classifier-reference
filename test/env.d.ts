import type { ProvidedEnv } from "@cloudflare/vitest-pool-workers";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
