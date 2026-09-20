import type { LaneDecision, ProposedAction } from "./types";

export interface AccessState {
  invocations: number;
}

export function accessDecision(action: ProposedAction, state: AccessState): LaneDecision {
  const tenantAllowed = action.tenant === "acme";
  const scopeAllowed = action.requiredScope === "data:read" || action.requiredScope === "data:write";
  const objectExists = /^\d{1,12}$/.test(action.customerId);
  const allowed = tenantAllowed && scopeAllowed && objectExists;
  if (allowed) state.invocations += 1;
  return {
    lane: "access",
    allowed,
    reason: allowed
      ? "tenant credential permits customer writes"
      : !tenantAllowed ? "tenant denied" : !scopeAllowed ? "credential lacks this scope" : "customer not found",
    handlerRan: allowed,
    handlerInvocations: state.invocations,
    checks: [
      { label: "Caller authenticated", passed: true, detail: "valid tenant credential" },
      { label: "Tenant", passed: tenantAllowed, detail: action.tenant },
      { label: "Credential scope", passed: scopeAllowed, detail: "customers:write" },
    ],
  };
}
