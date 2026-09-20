import { ACTION_LABELS, RISK_LABELS, type ActionLabel, type Classification, type FieldClassification, type RiskLabel } from "./types";

const MAX_TICKET_BYTES = 2_000;
const encoder = new TextEncoder();

function isNumberMap(value: unknown): value is Record<string, number> {
  return typeof value === "object" && value !== null
    && Object.values(value).every((item) => typeof item === "number" && item >= 0 && item <= 1);
}

function field<T extends string>(
  value: unknown,
  labels: readonly T[],
  name: string,
): FieldClassification<T> {
  if (typeof value !== "object" || value === null) throw new Error(`classifier returned no ${name} result`);
  const row = value as Record<string, unknown>;
  if (typeof row.label !== "string" || !labels.includes(row.label as T)) {
    throw new Error(`classifier returned an unknown ${name} label`);
  }
  if (row.confidence !== null && (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1)) {
    throw new Error(`classifier returned invalid ${name} confidence`);
  }
  if (row.scores !== null && !isNumberMap(row.scores)) throw new Error(`classifier returned invalid ${name} scores`);
  if (typeof row.model !== "string" || row.model.length === 0) throw new Error(`classifier returned no ${name} model`);
  return {
    label: row.label as T,
    confidence: row.confidence as number | null,
    scores: row.scores as Record<string, number> | null,
    model: row.model,
  };
}

export async function classifyTicket(
  ticket: string,
  origin: string,
  apiKey?: string,
  fetcher: typeof fetch = fetch,
): Promise<Classification> {
  if (ticket.length === 0 || encoder.encode(ticket).length > MAX_TICKET_BYTES) {
    throw new Error(`ticket must contain 1 to ${MAX_TICKET_BYTES} UTF-8 bytes`);
  }
  const headers = new Headers({
    "content-type": "application/json",
    "user-agent": "ratify-classifier-reference/0.1",
  });
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);

  const response = await fetcher(`${origin}/v1/classify`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      items: [ticket],
      dimensions: {
        action: {
          labels: ACTION_LABELS,
          instructions: "Choose the single customer-record operation requested by the text. Do not infer a different customer or operation.",
        },
        risk: {
          labels: RISK_LABELS,
          instructions: "Classify the consequence of carrying out the requested customer-record operation.",
        },
      },
      tier: "fast",
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`classifier unavailable (${response.status})`);

  const raw: unknown = await response.json();
  if (typeof raw !== "object" || raw === null) throw new Error("classifier returned an invalid body");
  const body = raw as Record<string, unknown>;
  const rows = body.results;
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0] !== "object" || rows[0] === null) {
    throw new Error("classifier returned an invalid result count");
  }
  const dimensions = (rows[0] as Record<string, unknown>).dimensions;
  if (typeof dimensions !== "object" || dimensions === null) throw new Error("classifier returned no dimensions");
  const values = dimensions as Record<string, unknown>;
  const usage = typeof body.usage === "object" && body.usage !== null ? body.usage as Record<string, unknown> : {};
  const modelsUsed = Array.isArray(body.modelsUsed) && body.modelsUsed.every((item) => typeof item === "string")
    ? body.modelsUsed as string[]
    : [];
  return {
    action: field<ActionLabel>(values.action, ACTION_LABELS, "action"),
    risk: field<RiskLabel>(values.risk, RISK_LABELS, "risk"),
    usageMs: typeof usage.ms === "number" ? usage.ms : 0,
    modelsUsed,
  };
}

