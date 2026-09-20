import "./style.css";

type ScenarioId = "authorized" | "wrong_customer" | "wrong_operation" | "replay" | "revoked";
interface Check { label: string; passed: boolean; detail: string }
interface Lane { allowed: boolean; reason: string; handlerInvocations: number; checks: Check[] }
interface DemoResult {
  classification: { action: { label: string; confidence: number | null; model: string } };
  proposal: { operation: string; customerId: string };
  access: Lane;
  authority: Lane;
}

const scenarios: Record<ScenarioId, { ticket: string; explanation: string }> = {
  authorized: { ticket: "Update the billing address for customer 482 to 16 Market Street.", explanation: "The proposed write stays inside the principal-signed customer, scope, and time window, and its operation-bound proof matches the exact call." },
  wrong_customer: { ticket: "Update the billing address on the Anderson account to 16 Market Street.", explanation: "Classification is correct, but the downstream resolver picks the wrong Anderson account. Tenant access cannot see that the mandate names customer 482." },
  wrong_operation: { ticket: "Look up customer 482 and show me the current billing address.", explanation: "classifier.dev proposes a read. The tenant credential permits reads, but the principal's mandate grants this agent one specific write." },
  replay: { ticket: "Update the billing address for customer 482 to 16 Market Street.", explanation: "The bearer request can be sent again. The Ratify challenge is accepted once." },
  revoked: { ticket: "Update the billing address for customer 482 to 16 Market Street.", explanation: "The tenant credential remains usable after the principal withdraws this agent's mandate." },
};

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element ${id}`);
  return element as T;
};
const ticket = byId("ticket");
const explanation = byId("scenario-explanation");
const proposal = byId("proposal");
const run = byId<HTMLButtonElement>("run");
const error = byId("error");
let selected: ScenarioId = "wrong_customer";
const sessionId = crypto.randomUUID();

function choose(id: ScenarioId): void {
  selected = id;
  document.querySelectorAll<HTMLButtonElement>("[data-scenario]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.scenario === id));
  });
  ticket.textContent = scenarios[id].ticket;
  explanation.textContent = scenarios[id].explanation;
  proposal.textContent = "Waiting for live classifier…";
  error.textContent = "";
}

function showLane(name: "access" | "authority", lane: Lane): void {
  const verdict = byId(`${name}-verdict`);
  verdict.className = `verdict ${lane.allowed ? "allowed" : "denied"}`;
  verdict.querySelector("span")!.textContent = lane.allowed ? "EXECUTED" : "STOPPED";
  verdict.querySelector("strong")!.textContent = lane.reason;
  byId(`${name}-count`).textContent = String(lane.handlerInvocations);
  const list = byId(`${name}-checks`);
  list.replaceChildren(...lane.checks.map((check) => {
    const item = document.createElement("li");
    item.className = check.passed ? "pass" : "fail";
    const icon = document.createElement("i");
    const text = document.createElement("span");
    text.textContent = check.label;
    const detail = document.createElement("small");
    detail.textContent = check.detail;
    item.appendChild(icon);
    item.appendChild(text);
    item.appendChild(detail);
    return item;
  }));
}

function apiPath(): string {
  const prefix = location.pathname.startsWith("/classifier-dev") ? "/classifier-dev" : "";
  return `${prefix}/api/run`;
}

document.querySelectorAll<HTMLButtonElement>("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => choose(button.dataset.scenario as ScenarioId));
});

run.addEventListener("click", async () => {
  run.disabled = true;
  run.querySelector("span")!.textContent = "Classifying live…";
  error.textContent = "";
  try {
    const response = await fetch(apiPath(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: selected, sessionId }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const code = typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : "request_failed";
      throw new Error(code.replaceAll("_", " "));
    }
    const result = body as DemoResult;
    byId("class-label").textContent = result.classification.action.label;
    byId("confidence").textContent = result.classification.action.confidence === null
      ? result.classification.action.model
      : `${Math.round(result.classification.action.confidence * 100)}% · ${result.classification.action.model}`;
    proposal.textContent = `${result.proposal.operation}(${result.proposal.customerId})`;
    showLane("access", result.access);
    showLane("authority", result.authority);
    document.querySelector(".lane-grid")?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (caught) {
    error.textContent = caught instanceof Error ? caught.message : "The demo could not run.";
  } finally {
    run.disabled = false;
    run.querySelector("span")!.textContent = "Run both receivers";
  }
});

choose(selected);
