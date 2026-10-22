import {
  buildSessionContextV2,
  operationContextV2Hash,
  type OperationContextV2,
} from "@identities-ai/ratify-protocol/v2";
import type { ActionLabel, ProposedAction } from "./types";

export const TENANT_RESOURCE = "crm:tenant/acme";
export const AUTHORIZED_CUSTOMER = "482";
export const AUTHORIZED_PATH = `/customers/${AUTHORIZED_CUSTOMER}/billing-address`;
// Protocol v2 session contexts take a canonical lowercase UUID workspace ID.
// The verifier ID is the receiver's 64-hex key ID (see authority.ts).
export const WORKSPACE_ID = "4f9d3c2a-8b1e-4c5d-9a7f-2e6b0c1d3a58";
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

export async function bindingFor(action: ProposedAction, verifierId: string, agentId: string): Promise<{
  operation: OperationContextV2;
  sessionContext: Uint8Array;
}> {
  const operation: OperationContextV2 = {
    required_scope: action.requiredScope,
    operation: action.operation,
    resource_id: TENANT_RESOURCE,
    requested_path: action.path,
    payload_digest: await sha256Json(action.payload),
  };
  return {
    operation,
    sessionContext: buildSessionContextV2({
      verifier_id: verifierId,
      workspace_id: WORKSPACE_ID,
      agent_id: agentId,
      session_id: SESSION_ID,
      invocation_id: action.invocationId,
      request_hash: operationContextV2Hash(operation),
    }),
  };
}
