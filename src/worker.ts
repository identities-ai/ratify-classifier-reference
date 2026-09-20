import { classifyTicket } from "./classifier";
import { DemoSession } from "./demo-session";
import { RateGate } from "./rate-gate";
import { isScenarioId, scenarioById } from "./scenarios";

export { DemoSession, RateGate };

const ROUTE_HEADER = "X-Ratify-Labs-Route";
const BASE_PATH = "/classifier-dev";
const encoder = new TextEncoder();

function headers(contentType = "application/json; charset=utf-8"): Headers {
  return new Headers({
    "content-type": contentType,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}

async function sameSecret(presented: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let different = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) different |= left[index]! ^ right[index]!;
  return different === 0;
}

async function routed(request: Request, env: Env): Promise<boolean> {
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (String(env.ALLOW_LOCAL_DEV) === "true") return true;
  if (!env.LABS_ROUTER_TOKEN || env.LABS_ROUTER_TOKEN.length < 32) return false;
  return sameSecret(request.headers.get(ROUTE_HEADER) ?? "", `Bearer ${env.LABS_ROUTER_TOKEN}`);
}

async function callerKey(request: Request, salt: string): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const key = await crypto.subtle.importKey("raw", encoder.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(ip)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runDemo(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 1_024) return json({ error: "request_too_large" }, 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (typeof body !== "object" || body === null) return json({ error: "invalid_request" }, 400);
  const input = body as Record<string, unknown>;
  if (!isScenarioId(input.scenario) || typeof input.sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.sessionId)) {
    return json({ error: "invalid_request" }, 400);
  }

  const day = Math.floor(Date.now() / 86_400_000);
  const rateName = `${day}:${await callerKey(request, env.PRIVACY_SALT)}`;
  const rateGate = env.RATE_GATES.get(env.RATE_GATES.idFromName(rateName));
  if (!await rateGate.allow(Date.now())) return json({ error: "rate_limited" }, 429);

  const scenario = scenarioById(input.scenario);
  const invocationId = crypto.randomUUID();
  const session = env.DEMO_SESSIONS.get(env.DEMO_SESSIONS.idFromName(input.sessionId));
  await session.prepare(invocationId);
  let classification;
  try {
    classification = await classifyTicket(
      scenario.ticket,
      env.CLASSIFIER_ORIGIN,
      (env as Env & { CLASSIFIER_API_KEY?: string }).CLASSIFIER_API_KEY,
    );
  } catch (error) {
    console.error(JSON.stringify({ event: "classification_failed", reason: error instanceof Error ? error.message : "unknown" }));
    return json({ error: "classifier_unavailable" }, 502);
  }
  if (classification.action.confidence === null || classification.action.confidence < 0.7) {
    return json({ error: "review_required", classification }, 422);
  }

  let result;
  try {
    result = await session.run({ scenario: input.scenario, classification, invocationId });
  } catch (error) {
    console.error(JSON.stringify({ event: "receiver_failed", reason: error instanceof Error ? error.message : "unknown" }));
    return json({ error: "action_not_executable" }, 422);
  }
  console.log(JSON.stringify({
    event: "demo_run",
    scenario: input.scenario,
    action: classification.action.label,
    access: result.access.allowed,
    authority: result.authority.allowed,
  }));
  return json(result);
}

function assetRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === BASE_PATH) url.pathname = "/";
  else if (url.pathname.startsWith(`${BASE_PATH}/`)) url.pathname = url.pathname.slice(BASE_PATH.length);
  return new Request(url, request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!await routed(request, env)) return new Response("Not found", { status: 404, headers: headers("text/plain; charset=utf-8") });
    const url = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === BASE_PATH) {
      return new Response(null, {
        status: 308,
        headers: new Headers({
          Location: `${BASE_PATH}/${url.search}`,
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "SAMEORIGIN",
        }),
      });
    }
    const path = url.pathname.startsWith(BASE_PATH) ? url.pathname.slice(BASE_PATH.length) || "/" : url.pathname;
    if (path === "/api/run") return runDemo(request, env);
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405);
    const response = await env.ASSETS.fetch(assetRequest(request));
    const assetHeaders = new Headers(response.headers);
    assetHeaders.set("content-security-policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'");
    assetHeaders.set("referrer-policy", "no-referrer");
    assetHeaders.set("x-content-type-options", "nosniff");
    assetHeaders.set("x-frame-options", "SAMEORIGIN");
    if (!assetHeaders.has("cache-control")) assetHeaders.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers: assetHeaders });
  },
} satisfies ExportedHandler<Env>;
