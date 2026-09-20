import {
  buildSessionContext,
  operationContextHash,
  type OperationContext,
} from "@identities-ai/ratify-protocol";
import type { ActionLabel, ProposedAction } from "./types";

export const TENANT_RESOURCE = "crm:tenant/acme";
export const AUTHORIZED_CUSTOMER = "482";
export const AUTHORIZED_PATH = `/customers/${AUTHORIZED_CUSTOMER}/billing-address`;
export const VERIFIER_ID = "ratify-classifier-reference-receiver";
export const WORKSPACE_ID = "acme-support";
export const SESSION_ID = "classifier-write-demo";

const actionMap: Record<Exclude<ActionLabel, "none of these">, Pick<ProposedAction, "operation" | "requiredScope">> = {
  "read customer": { operation: "customer.read", requiredScope: "data:read" },
  "update customer": { operation: "customer.update", requiredScope: "data:write" },
  "delete customer": { operation: "customer.delete", requiredScope: "data:delete" },
};

function customerFrom(ticket: string): string {
  const match = ticket.match(/\bcustomer\s+(\d{1,12})\b/i);
  if (match?.[1]) return match[1];
  if (/\bAnderson account\b/i.test(ticket)) return "007";
  throw new Error("ticket could not be resolved to a customer");
}

export function proposalFrom(label: ActionLabel, ticket: string, invocationId: string): ProposedAction {
  if (label === "none of these") throw new Error("classifier did not select an executable customer action");
  const mapped = actionMap[label];
  const customerId = customerFrom(ticket);
  const path = mapped.operation === "customer.update"
    ? `/customers/${customerId}/billing-address`
    : `/customers/${customerId}`;
  return {
    ...mapped,
    tenant: "acme",
    customerId,
    path,
    payload: mapped.operation === "customer.update" ? { billing_address: "16 Market Street" } : {},
    invocationId,
  };
}

async function sha256Json(value: unknown): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function bindingFor(action: ProposedAction, agentId: string): Promise<{
  operation: OperationContext;
  sessionContext: Uint8Array;
}> {
  const operation: OperationContext = {
    required_scope: action.requiredScope,
    operation: action.operation,
    resource_id: TENANT_RESOURCE,
    requested_path: action.path,
    payload_digest: await sha256Json(action.payload),
  };
  return {
    operation,
    sessionContext: buildSessionContext({
      verifier_id: VERIFIER_ID,
      workspace_id: WORKSPACE_ID,
      agent_id: agentId,
      session_id: SESSION_ID,
      invocation_id: action.invocationId,
      request_hash: operationContextHash(operation),
    }),
  };
}
