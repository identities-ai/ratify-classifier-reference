import { DurableObject } from "cloudflare:workers";
import {
  UNKNOWN_CHALLENGE,
  base64StandardEncode,
  decodeDelegationCert,
  encodeDelegationCert,
  generateChallenge,
  verifyBundle,
  type ChallengeStore,
} from "@identities-ai/ratify-protocol";
import { accessDecision } from "./access";
import { createDemoAuthority, presentAuthority } from "./authority";
import { bindingFor, proposalFrom, TENANT_RESOURCE } from "./operation";
import { scenarioById } from "./scenarios";
import type { Classification, DemoRun, LaneDecision, ProposedAction, ScenarioId } from "./types";

interface RunInput {
  scenario: ScenarioId;
  classification: Classification;
  invocationId: string;
}

class DurableChallengeStore implements ChallengeStore {
  constructor(private readonly sql: SqlStorage) {}

  async issue(sessionContext: Uint8Array | undefined, ttlSeconds: number) {
    const now = Math.floor(Date.now() / 1000);
    this.sql.exec("DELETE FROM challenges WHERE expires_at < ?", now);
    const count = this.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM challenges").one().count;
    if (count >= 100) throw new Error("challenge store full");
    const challenge = generateChallenge();
    const expiresAt = now + ttlSeconds;
    this.sql.exec(
      "INSERT INTO challenges (challenge, session_context, expires_at) VALUES (?, ?, ?)",
      base64StandardEncode(challenge),
      base64StandardEncode(sessionContext ?? new Uint8Array()),
      expiresAt,
    );
    return { challenge, expires_at: expiresAt };
  }

  async validate(challenge: Uint8Array, sessionContext: Uint8Array | undefined, now: number) {
    const row = this.sql.exec<{ found: number }>(
      "SELECT 1 AS found FROM challenges WHERE challenge = ? AND session_context = ? AND expires_at >= ?",
      base64StandardEncode(challenge),
      base64StandardEncode(sessionContext ?? new Uint8Array()),
      now,
    ).toArray();
    return row.length === 1 ? null : UNKNOWN_CHALLENGE;
  }

  async consume(challenge: Uint8Array, sessionContext: Uint8Array | undefined, now: number) {
    const rows = this.sql.exec<{ challenge: string }>(
      "DELETE FROM challenges WHERE challenge = ? AND session_context = ? AND expires_at >= ? RETURNING challenge",
      base64StandardEncode(challenge),
      base64StandardEncode(sessionContext ?? new Uint8Array()),
      now,
    ).toArray();
    return rows.length === 1 ? null : UNKNOWN_CHALLENGE;
  }
}

export class DemoSession extends DurableObject<Env> {
  private readonly challenges: DurableChallengeStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS challenges (challenge TEXT PRIMARY KEY, session_context TEXT NOT NULL, expires_at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS counters (lane TEXT PRIMARY KEY, invocations INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS grants (invocation_id TEXT PRIMARY KEY, issued_at INTEGER NOT NULL, delegation TEXT NOT NULL)");
    sql.exec("INSERT OR IGNORE INTO counters (lane, invocations) VALUES ('access', 0), ('authority', 0)");
    this.challenges = new DurableChallengeStore(sql);
  }

  async prepare(invocationId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const authority = await createDemoAuthority(now, invocationId);
    this.ctx.storage.sql.exec("DELETE FROM grants WHERE issued_at < ?", now - 900);
    this.ctx.storage.sql.exec(
      "INSERT INTO grants (invocation_id, issued_at, delegation) VALUES (?, ?, ?)",
      invocationId,
      now,
      encodeDelegationCert(authority.delegation),
    );
  }

  private count(lane: "access" | "authority"): number {
    return this.ctx.storage.sql.exec<{ invocations: number }>(
      "SELECT invocations FROM counters WHERE lane = ?",
      lane,
    ).one().invocations;
  }

  private increment(lane: "access" | "authority"): number {
    return this.ctx.storage.sql.exec<{ invocations: number }>(
      "UPDATE counters SET invocations = invocations + 1 WHERE lane = ? RETURNING invocations",
      lane,
    ).one().invocations;
  }

  async run(input: RunInput): Promise<DemoRun> {
    const scenario = scenarioById(input.scenario);
    let proposal = proposalFrom(input.classification.action.label, scenario.ticket, input.invocationId);
    const accessState = { invocations: this.count("access") };
    const access = accessDecision(proposal, accessState);
    if (access.allowed) {
      access.handlerInvocations = this.increment("access");
      if (input.scenario === "replay") access.handlerInvocations = this.increment("access");
    }

    const grant = this.ctx.storage.sql.exec<{ issued_at: number; delegation: string }>(
      "SELECT issued_at, delegation FROM grants WHERE invocation_id = ?",
      input.invocationId,
    ).one();
    const now = Math.floor(Date.now() / 1000);
    const authority = await createDemoAuthority(grant.issued_at, input.invocationId);
    authority.delegation = decodeDelegationCert(grant.delegation);
    const originalBinding = await bindingFor(proposal, authority.agent.id);
    const issued = await this.challenges.issue(originalBinding.sessionContext, 60);
    const proof = await presentAuthority(authority, issued.challenge, originalBinding.sessionContext, now);

    const receiverBinding = await bindingFor(proposal, authority.agent.id);
    const verify = () => verifyBundle(proof, {
      required_scope: proposal.requiredScope,
      now,
      session_context: receiverBinding.sessionContext,
      challenge_store: this.challenges,
      is_revoked: (certId) => input.scenario === "revoked" && certId === authority.delegation.cert_id,
      context: {
        has_resource: true,
        requested_resource_id: TENANT_RESOURCE,
        requested_path: proposal.path,
      },
    });

    let result = await verify();
    if (input.scenario === "replay" && result.valid) result = await verify();
    const trustedRoot = result.human_id === authority.root.id;
    const allowed = result.valid && trustedRoot;
    const authorityCount = allowed ? this.increment("authority") : this.count("authority");
    const statusReason: Partial<Record<string, string>> = {
      scope_denied: "mandate does not grant the proposed scope",
      constraint_denied: "path is outside the signed resource bound",
      unauthorized: "receiver challenge was already used",
      revoked: "principal authority has been revoked",
      invalid: "proof did not verify",
    };
    const proofCert = proof.delegations[0];
    const operationInScope = result.identity_status !== "scope_denied";
    const pathInScope = result.identity_status !== "constraint_denied";
    const challengeFresh = result.identity_status !== "unauthorized";
    const notRevoked = result.identity_status !== "revoked";
    const trustedPresentedRoot = proofCert?.issuer_id === authority.root.id;
    const authorityDecision: LaneDecision = {
      lane: "authority",
      allowed,
      reason: allowed ? "exact principal mandate verified" : (!trustedRoot && result.valid ? "principal is not a trusted root" : (statusReason[result.identity_status] ?? result.error_reason ?? result.identity_status)),
      handlerRan: allowed,
      handlerInvocations: authorityCount,
      checks: [
        { label: "Hybrid signature", passed: result.identity_status !== "invalid", detail: "Ed25519 + ML-DSA-65" },
        { label: "Trusted principal", passed: trustedPresentedRoot, detail: "receiver-pinned root" },
        { label: "Mandated operation", passed: operationInScope, detail: proposal.operation },
        { label: "Mandated customer path", passed: pathInScope, detail: proposal.path },
        { label: "Fresh and single-use", passed: challengeFresh, detail: "receiver challenge" },
        { label: "Not revoked", passed: notRevoked, detail: authority.delegation.cert_id },
      ],
    };

    return {
      scenario: input.scenario,
      ticket: scenario.ticket,
      classification: input.classification,
      proposal,
      mandate: {
        principal: authority.root.id,
        agent: authority.agent.id,
        operation: "data:write",
        resource: TENANT_RESOURCE,
        path: authority.delegation.constraints[0]?.path_prefix ?? "",
        expiresAt: authority.delegation.expires_at,
      },
      access,
      authority: authorityDecision,
      disclosure: "Ratify verifies authority, not classifier correctness. The receiver reconstructs and enforces the proposed operation.",
    };
  }
}
