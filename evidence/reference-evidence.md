# classifier.dev × Ratify Protocol reference evidence

Executed locally on 2026-09-19 with Node.js 22.13.0, Ratify SDK `1.0.0-alpha.20`, Wrangler `4.135.0`, Vite `8.3.0`, Vitest `4.1.0`, and the Cloudflare Workers runtime supplied by `@cloudflare/vitest-pool-workers`.

Command:

```text
npm run check
```

Observed result:

```text
Types at worker-configuration.d.ts are up to date.
Test Files  1 passed (1)
Tests  6 passed (6)
Build completed successfully.
```

The six tests include five Durable Object receiver cases and one strict classifier.dev multidimensional response parser case. No test was skipped, marked expected failure, or dependent on model judgment.

The live browser smoke test used the default wrong-account case against classifier.dev's public endpoint. classifier.dev returned `update customer` with `100% · jev-1.13.0`; tenant access executed the resolved customer 007 call and the Ratify receiver stopped it at the signed resource bound. The exact customer 482 case executed in both lanes.

The origin smoke test used the built Worker through Wrangler local mode:

```text
foreign Host header on /  -> 404
local request on /        -> 200
```

This is local evidence for an independent draft. It is not classifier.dev endorsement, a production security assessment, or a claim that the public demo identities can be used outside this reference.
