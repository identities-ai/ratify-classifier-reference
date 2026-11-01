# classifier.dev × Ratify Protocol reference evidence

## Protocol v2 run on the published beta (2026-11-01)

Executed locally on 2026-11-01 with Node.js 22.23.4 (npm 10.9.9, the Node.js version CI uses), Wrangler `4.135.0`, Vite `8.3.0`, Vitest `4.1.0`, and the Cloudflare Workers runtime supplied by `@cloudflare/vitest-pool-workers`.

Ratify SDK: the Protocol v2 API (`@identities-ai/ratify-protocol/v2`) from the published npm package `@identities-ai/ratify-protocol@2.0.0-beta.1`, pinned exactly in `package.json` and locked in `package-lock.json` with integrity `sha512-z46s51qBgiZF3XYKBv8fc4o3pzWk2220xvEjELp66fcI72LwkO9wSPX/LBMDKLSxsrE7H2YvbhGuN46UQrYT2Q==`. The vendored pre-release build is removed.

One source change came with the beta: `verifyProofBundleV2` now requires the caller-authenticated `verifierID`, and the receiver passes its own verifier key ID. Without it the receiver does not type-check against the beta.

Commands:

```text
npm ci
npm run check
```

Observed result:

```text
Types at worker-configuration.d.ts are up to date.
Test Files  1 passed (1)
Tests  6 passed (6)
✓ built (Worker bundle)
✓ built (client bundle)
```

The six tests and their assertions are the ones described in the 2026-10-22 run below. No test was skipped, marked expected failure, or dependent on model judgment. The mutation check below was not repeated on the beta.

Limits of this run are the same as for the 2026-10-22 run: test-only reference stores rebuilt for every run, a deterministic gate result rather than a production-shaped deployment, no update to or exercise of the live Labs deployment for v2, and no browser smoke test against classifier.dev for v2.

## Protocol v2 pre-release run (2026-10-22, historical)

Kept as dated history. It ran against an unpublished pre-release build of the SDK, since replaced by the published beta.

Executed locally on 2026-10-22 with Node.js 22.13.0 (npm 10.9.2, the version CI uses), Wrangler `4.135.0`, Vite `8.3.0`, Vitest `4.1.0`, and the Cloudflare Workers runtime supplied by `@cloudflare/vitest-pool-workers`. The gate was also run under Node.js 26.10.0 with the same result.

Ratify SDK: the Protocol v2 API (`@identities-ai/ratify-protocol/v2`) from a local build of the protocol source at commit `5f1093e`, package version `2.0.0-alpha.1`, vendored as `vendor/identities-ai-ratify-protocol-2.0.0-alpha.1-5f1093e.tgz` (SHA-256 `a701f9913fa52ea2905522a9ebee72892913917cdf8bea54414b00c41ee6a668`). This was not a published package; the 2026-11-01 run above replaces it with the published `2.0.0-beta.1`.

Commands:

```text
npm ci
npm run check
```

Observed result:

```text
Types at worker-configuration.d.ts are up to date.
Test Files  1 passed (1)
Tests  6 passed (6)
✓ built (Worker bundle)
✓ built (client bundle)
```

The six tests are the same five Durable Object receiver cases and the classifier.dev response parser case as the v1 run, with stronger assertions. Each deny case now asserts the released v2 reason and that only the expected check failed (`scope_denied` for the different operation, `constraint_denied` for the wrong customer, `delegation_revoked` for revoked authority). The exact-mandate case asserts that every check passes, including release, and that identities are 64-hex key IDs. No test was skipped, marked expected failure, or dependent on model judgment.

v2 features exercised: v2 delegation with a `resource_path` constraint; v2 operation and session context with a bound context policy; challenge issuance through the issuance helper into a durable SQLite issuance store; signed revocation status from a status publisher under a status key separate from the root key; complete root-key pin; verification, receipt publication, checkpoint acknowledgement and release; `allowed()` at the receiver's clock; replay rejected before evaluation.

Mutation check: three deliberate faults were each caught by the suite (one failing test each): withholding the revocation from the status feed, evaluating a fixed authorized path instead of the proposed path, and skipping the replay presentation.

Limits of this run: the claim store, receipt log, checkpoint and security journal are the SDK's test-only reference stores, rebuilt for every run. This is a deterministic gate result, not a production-shaped deployment. The live Labs deployment was not updated or exercised for v2, and no browser smoke test was run against classifier.dev for v2.

## Protocol v1 run (2026-09-19, historical)

Kept as dated history. It describes the earlier Protocol v1 version of this reference.

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
