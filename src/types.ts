export const SCENARIO_IDS = ["authorized", "wrong_customer", "wrong_operation", "replay", "revoked"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const ACTION_LABELS = ["read customer", "update customer", "delete customer", "none of these"] as const;
export type ActionLabel = (typeof ACTION_LABELS)[number];

export const RISK_LABELS = ["read only", "changes customer data", "deletes customer data"] as const;
export type RiskLabel = (typeof RISK_LABELS)[number];

export interface FieldClassification<T extends string> {
  label: T;
  confidence: number | null;
  scores: Record<string, number> | null;
  model: string;
}

export interface Classification {
  action: FieldClassification<ActionLabel>;
  risk: FieldClassification<RiskLabel>;
  usageMs: number;
  modelsUsed: string[];
}

export interface ProposedAction {
  operation: "customer.read" | "customer.update" | "customer.delete";
  requiredScope: "data:read" | "data:write" | "data:delete";
  tenant: "acme";
  customerId: string;
  path: string;
  payload: Record<string, string>;
  invocationId: string;
}

export interface LaneDecision {
  lane: "access" | "authority";
  allowed: boolean;
  reason: string;
  handlerRan: boolean;
  handlerInvocations: number;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
}

export interface DemoRun {
  scenario: ScenarioId;
  ticket: string;
  classification: Classification;
  proposal: ProposedAction;
  mandate: {
    principal: string;
    agent: string;
    operation: string;
    resource: string;
    path: string;
    expiresAt: number;
  };
  access: LaneDecision;
  authority: LaneDecision;
  disclosure: string;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  ticket: string;
  explanation: string;
}
