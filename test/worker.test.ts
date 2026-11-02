import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { classifyTicket } from "../src/classifier";
import type { Classification, ScenarioId } from "../src/types";

function classification(scenario: ScenarioId): Classification {
  const action = scenario === "wrong_operation" ? "read customer" : "update customer";
  const risk = scenario === "wrong_operation" ? "read only" : "changes customer data";
  return {
    action: { label: action, confidence: 0.96, scores: { [action]: 0.96 }, model: "jev-1.13.0" },
    risk: { label: risk, confidence: 0.94, scores: { [risk]: 0.94 }, model: "jev-1.13.0" },
    usageMs: 103,
    modelsUsed: ["jev-1.13.0"],
  };
}

async function run(scenario: ScenarioId) {
  const session = env.DEMO_SESSIONS.get(env.DEMO_SESSIONS.newUniqueId());
  const invocationId = crypto.randomUUID();
  await session.prepare(invocationId);
  return session.run({ scenario, invocationId, classification: classification(scenario) });
}

describe("classifier to authority boundary", () => {
  it("uses classifier.dev's multidimensional result as the proposed action", async () => {
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { dimensions: Record<string, unknown> };
      expect(Object.keys(sent.dimensions)).toEqual(["action", "risk"]);
      return new Response(JSON.stringify({
        modelsUsed: ["jev-1.13.0"],
        results: [{ dimensions: {
          action: { label: "read customer", confidence: 0.91, scores: { "read customer": 0.91 }, model: "jev-1.13.0" },
          risk: { label: "read only", confidence: 0.93, scores: { "read only": 0.93 }, model: "jev-1.13.0" },
        } }],
        usage: { ms: 88 },
      }), { headers: { "content-type": "application/json" } });
    };
    const result = await classifyTicket("Read customer 482", "https://classifier.test", undefined, fakeFetch as typeof fetch);
    expect(result.action.label).toBe("read customer");
  });

  it("executes when the classifier proposal exactly matches the signed mandate", async () => {
    const result = await run("authorized");
    expect(result.access.allowed).toBe(true);
    expect(result.authority.allowed).toBe(true);
    // Protocol v2: every check passes, including release of the signed
    // receipt, and identities are 64-hex key IDs.
    expect(result.authority.checks.every((check) => check.passed)).toBe(true);
    expect(result.authority.checks.find((check) => check.label === "Released")?.passed).toBe(true);
    expect(result.mandate.principal).toMatch(/^[0-9a-f]{64}$/);
    expect(result.mandate.agent).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows tenant access cannot distinguish the wrong customer", async () => {
    const result = await run("wrong_customer");
    expect(result.proposal.customerId).toBe("007");
    expect(result.access.allowed).toBe(true);
    expect(result.authority.allowed).toBe(false);
    expect(result.authority.reason).toContain("signed resource bound");
    expect(result.authority.checks.filter((check) => !check.passed).map((check) => check.label)).toEqual(["Mandated customer path"]);
  });

  it.each([
    ["wrong_operation", "Mandated operation", "mandate does not grant the proposed scope"],
    ["revoked", "Not revoked", "principal authority has been revoked"],
  ] as const)("stops %s only at the authority receiver", async (scenario, failedCheck, reason) => {
    const result = await run(scenario);
    expect(result.access.allowed).toBe(true);
    expect(result.authority.allowed).toBe(false);
    // The deny is a released v2 decision for the stated reason, not a
    // verification error: only the named check fails.
    expect(result.authority.reason).toBe(reason);
    expect(result.authority.checks.filter((check) => !check.passed).map((check) => check.label)).toEqual([failedCheck]);
  });

  it("executes the original request once and stops a copied replay", async () => {
    const result = await run("replay");
    expect(result.access.handlerInvocations).toBe(2);
    expect(result.authority.allowed).toBe(true);
    expect(result.authority.handlerInvocations).toBe(1);
    expect(result.authority.reason).toContain("copied request stopped");
    expect(result.authority.checks.find((check) => check.label === "Fresh and single-use")?.passed).toBe(false);
  });
});
