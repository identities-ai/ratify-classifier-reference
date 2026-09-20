import type { ScenarioDefinition, ScenarioId } from "./types";

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  authorized: {
    id: "authorized",
    name: "Exact mandate",
    ticket: "Update the billing address for customer 482 to 16 Market Street.",
    explanation: "The proposed write stays inside the principal-signed customer, scope, and time window, and its operation-bound proof matches the exact call.",
  },
  wrong_customer: {
    id: "wrong_customer",
    name: "Wrong customer",
    ticket: "Update the billing address on the Anderson account to 16 Market Street.",
    explanation: "Classification is correct, but the downstream resolver picks the wrong Anderson account. Tenant access cannot see that the mandate names customer 482.",
  },
  wrong_operation: {
    id: "wrong_operation",
    name: "Different operation",
    ticket: "Look up customer 482 and show me the current billing address.",
    explanation: "classifier.dev proposes a read. The tenant credential permits reads, but the principal's mandate grants this agent one specific write.",
  },
  replay: {
    id: "replay",
    name: "Copied request",
    ticket: "Update the billing address for customer 482 to 16 Market Street.",
    explanation: "The bearer request can be sent again. The Ratify challenge is accepted once.",
  },
  revoked: {
    id: "revoked",
    name: "Authority revoked",
    ticket: "Update the billing address for customer 482 to 16 Market Street.",
    explanation: "The tenant credential remains usable after the principal withdraws this agent's mandate.",
  },
};

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && value in SCENARIOS;
}

export function scenarioById(id: ScenarioId): ScenarioDefinition {
  return SCENARIOS[id];
}
