import { DurableObject } from "cloudflare:workers";
// RATIFY_V2_PIN: Protocol v2 SDK from the vendored local build in vendor/.
// Switch package.json to the published 2.0.0-beta.1 package at release.
import {
  ErrV2ChallengeIssuanceConflict,
  ErrV2ChallengeIssuanceNotFound,
  TZDB_VERSION_V2,
  challengeClaimDigestV2,
  configureStatusKeyEpochV2,
  decodeDelegationCertV2,
  encodeDelegationCertV2,
  encodeProofBundleV2,
  encodeRevocationListV2,
  encodeRevocationPushV2,
  issueChallengeV2,
  loadExpectedChallengeV2,
  newV2ContextPolicy,
  newV2StatusPublisherWithKey,
  recordSecurityKeyRoleV2,
  releaseV2Decision,
  verifyProofBundleV2,
  type ExpectedChallengeV2,
  type RevocationStatusPolicyV2,
  type V2ChallengeIssuanceStore,
  type V2StatusEvidenceObject,
  type V2VerifyOutcome,
} from "@identities-ai/ratify-protocol/v2";
// TEST-ONLY reference stores (claim store, receipt log, checkpoint and
// security journal). They are rebuilt for every run and are not durable.
// A production receiver supplies durable Part B stores and an independent
// checkpoint (SPEC-v2 §7).
import { JournalStoreTestOnly, StoreTestOnly } from "@identities-ai/ratify-protocol/v2/reference";
import { accessDecision } from "./access";
import { demoKeys, issueDemoDelegation, presentAuthority } from "./authority";
import { bindingFor, proposalFrom, TENANT_RESOURCE } from "./operation";
import { scenarioById } from "./scenarios";
import type { Classification, DemoRun, LaneDecision, ScenarioId } from "./types";

interface RunInput {
  scenario: ScenarioId;
  classification: Classification;
  invocationId: string;
}

const NAMESPACE = "ratify-classifier-reference";
const REPLAY_EPOCH = 1;
const LOG_ID = "00000000000000000000000000000c1a";
const CONTEXT_PROFILE = "ratify-classifier-reference.session-context/v1";
const CONTEXT_FIELDS = ["verifier_id", "workspace_id", "agent_id", "session_id", "invocation_id", "request_hash"];
const STATUS_POLICY: RevocationStatusPolicyV2 = { maxListLifetimeSeconds: 3600, maxStatusAgeSeconds: 3600, clockSkewSeconds: 5 };

const toHex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

interface IssuanceRow extends Record<string, SqlStorageValue> {
  value: string;
  issued_at: number;
  expires_at: number;
  verifier_id: string;
  agent_id: string;
  agent_ed25519: string;
  agent_ml_dsa_65: string;
  session_context: string;
}

/**
 * Durable v2 challenge issuance store in Durable Object SQLite. The record
 * is committed before issueChallengeV2 returns the challenge, an existing key
 * is never overwritten, and an unknown challenge is reported as not found.
 */
class DurableChallengeIssuanceStore implements V2ChallengeIssuanceStore {
  constructor(private readonly sql: SqlStorage) {}

  private key(namespace: string, replayEpoch: number, claimDigest: Uint8Array): string {
    return `${namespace}|${replayEpoch}|${toHex(claimDigest)}`;
  }

  async persistV2Challenge(record: ExpectedChallengeV2): Promise<void> {
    this.sql.exec("DELETE FROM v2_challenges WHERE expires_at < ?", record.issuedAt);
    const count = this.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM v2_challenges").one().count;
    if (count >= 100) throw new Error("challenge issuance store full");
    const key = this.key(record.verifierNamespace, record.replayEpoch, challengeClaimDigestV2(record.value));
    if (this.sql.exec("SELECT 1 FROM v2_challenges WHERE issuance_key = ?", key).toArray().length > 0) {
      throw ErrV2ChallengeIssuanceConflict;
    }
    if (!record.expectedAgentID || !record.expectedAgentPublicKey || !record.expectedSessionContext) {
      throw new Error("this receiver issues only agent-bound, context-bound challenges");
    }
    this.sql.exec(
      `INSERT INTO v2_challenges (issuance_key, value, issued_at, expires_at, verifier_id, agent_id, agent_ed25519, agent_ml_dsa_65, session_context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      key,
      toHex(record.value),
      record.issuedAt,
      record.expiresAt,
      record.verifierID,
      record.expectedAgentID,
      toHex(record.expectedAgentPublicKey.ed25519),
      toHex(record.expectedAgentPublicKey.ml_dsa_65),
      toHex(record.expectedSessionContext),
    );
  }

  async loadV2Challenge(namespace: string, replayEpoch: number, claimDigest: Uint8Array): Promise<ExpectedChallengeV2> {
    const rows = this.sql.exec<IssuanceRow>(
      "SELECT value, issued_at, expires_at, verifier_id, agent_id, agent_ed25519, agent_ml_dsa_65, session_context FROM v2_challenges WHERE issuance_key = ?",
      this.key(namespace, replayEpoch, claimDigest),
    ).toArray();
    const row = rows[0];
    if (!row) throw ErrV2ChallengeIssuanceNotFound;
    return {
      value: fromHex(row.value),
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      verifierNamespace: namespace,
      replayEpoch,
      verifierID: row.verifier_id,
      expectedAgentID: row.agent_id,
      expectedAgentPublicKey: { ed25519: fromHex(row.agent_ed25519), ml_dsa_65: fromHex(row.agent_ml_dsa_65) },
      expectedSessionContext: fromHex(row.session_context),
    };
  }
}

const reasonText: Partial<Record<string, string>> = {
  scope_denied: "mandate does not grant the proposed scope",
  constraint_denied: "path is outside the signed resource bound",
  delegation_revoked: "principal authority has been revoked",
  not_delegated: "principal is not a trusted root",
  delegation_not_authorized: "principal is not a trusted root",
  proof_invalid: "proof did not verify",
};

export class DemoSession extends DurableObject<Env> {
  private readonly issuance: DurableChallengeIssuanceStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    // Protocol v1 tables from earlier deployments.
    sql.exec("DROP TABLE IF EXISTS challenges");
    sql.exec("DROP TABLE IF EXISTS grants");
    sql.exec(`CREATE TABLE IF NOT EXISTS v2_challenges (
      issuance_key TEXT PRIMARY KEY, value TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      verifier_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_ed25519 TEXT NOT NULL, agent_ml_dsa_65 TEXT NOT NULL,
      session_context TEXT NOT NULL)`);
    sql.exec("CREATE TABLE IF NOT EXISTS counters (lane TEXT PRIMARY KEY, invocations INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS v2_grants (invocation_id TEXT PRIMARY KEY, issued_at INTEGER NOT NULL, delegation TEXT NOT NULL)");
    sql.exec("INSERT OR IGNORE INTO counters (lane, invocations) VALUES ('access', 0), ('authority', 0)");
    this.issuance = new DurableChallengeIssuanceStore(sql);
  }

  async prepare(invocationId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const delegation = await issueDemoDelegation(await demoKeys(), now, invocationId);
    this.ctx.storage.sql.exec("DELETE FROM v2_grants WHERE issued_at < ?", now - 900);
    this.ctx.storage.sql.exec(
      "INSERT INTO v2_grants (invocation_id, issued_at, delegation) VALUES (?, ?, ?)",
      invocationId,
      now,
      toHex(encodeDelegationCertV2(delegation)),
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
    const proposal = proposalFrom(input.classification.action.label, scenario.ticket, input.invocationId);
    const accessState = { invocations: this.count("access") };
    const access = accessDecision(proposal, accessState);
    if (access.allowed) {
      access.handlerInvocations = this.increment("access");
      if (input.scenario === "replay") access.handlerInvocations = this.increment("access");
    }

    const grant = this.ctx.storage.sql.exec<{ issued_at: number; delegation: string }>(
      "SELECT issued_at, delegation FROM v2_grants WHERE invocation_id = ?",
      input.invocationId,
    ).one();
    const delegation = decodeDelegationCertV2(fromHex(grant.delegation));
    const keys = await demoKeys();
    const now = Math.floor(Date.now() / 1000);

    // Receiver state for this run. The test-only store is the claim store,
    // receipt log, checkpoint and authoritative clock.
    const store = new StoreTestOnly(now, 30, LOG_ID, keys.verifier.keys);
    const journal = new JournalStoreTestOnly();
    await recordSecurityKeyRoleV2(journal, "issuer", keys.root.keys.publicKey);
    await recordSecurityKeyRoleV2(journal, "delegation", keys.agent.keys.publicKey);
    await recordSecurityKeyRoleV2(journal, "verifier", keys.verifier.keys.publicKey);
    await configureStatusKeyEpochV2(journal, keys.root.id, 1, keys.status.keys.publicKey);

    // The principal's status publisher signs status under the separate
    // status key. Revocation is a signed push plus the cumulative list.
    const publisher = await newV2StatusPublisherWithKey(journal, keys.root.keys.publicKey, keys.status.keys, 3600);
    const genesis = await publisher.genesis(now - 1);
    let statusEvidence: V2StatusEvidenceObject[] = [{ objectType: 3, wire: encodeRevocationListV2(genesis.list) }];
    if (input.scenario === "revoked") {
      const revoked = await publisher.revoke(genesis.state, [delegation.cert_id], now);
      if (!revoked.push) throw new Error("status publisher returned no revocation push");
      statusEvidence = [
        { objectType: 5, wire: encodeRevocationPushV2(revoked.push) },
        { objectType: 3, wire: encodeRevocationListV2(revoked.list) },
      ];
    }

    // The receiver issues a challenge bound to the agent and to the
    // operation it reconstructed. The record is durable before it returns.
    const originalBinding = await bindingFor(proposal, keys.verifier.id, keys.agent.id);
    const challenge = await issueChallengeV2({ clock: store, store: this.issuance }, {
      verifierNamespace: NAMESPACE,
      replayEpoch: REPLAY_EPOCH,
      verifierID: keys.verifier.id,
      lifetimeSeconds: 60,
      expectedAgentID: keys.agent.id,
      expectedAgentPublicKey: keys.agent.keys.publicKey,
      expectedSessionContext: originalBinding.sessionContext,
    });
    const proof = await presentAuthority(keys, delegation, challenge, originalBinding.sessionContext);
    const proofWire = encodeProofBundleV2(proof);

    const receiverBinding = await bindingFor(proposal, keys.verifier.id, keys.agent.id);
    const verify = async (): Promise<V2VerifyOutcome> => verifyProofBundleV2({
      bundle: proofWire,
      expected: await loadExpectedChallengeV2(this.issuance, NAMESPACE, REPLAY_EPOCH, proof.challenge),
      contextPolicy: newV2ContextPolicy(CONTEXT_PROFILE, true, CONTEXT_FIELDS, receiverBinding.sessionContext),
      requiredScope: proposal.requiredScope,
      verifierNamespace: NAMESPACE,
      replayEpoch: REPLAY_EPOCH,
      now: store.now(),
      maxChallengeAgeSeconds: 300,
      futureSkewSeconds: 5,
      context: { hasResource: true, requestedResourceID: TENANT_RESOURCE, requestedPath: proposal.path },
      tzdbVersion: TZDB_VERSION_V2,
      statusKeys: new Map([[keys.root.id, { epoch: 1, key: keys.status.keys.publicKey }]]),
      statusPolicy: STATUS_POLICY,
    }, {
      claimStore: store,
      // Trust is pinned to the complete root public key, never a key ID.
      trust: (chain) => chain[chain.length - 1]!.issuer_id === keys.root.id
        ? { outcome: "trusted", rootKey: keys.root.keys.publicKey }
        : { outcome: "untrusted" },
      statusEvidence: async () => ({ objects: statusEvidence }),
      statusJournal: journal,
    });

    const first = await verify();
    let released = false;
    let allowed = false;
    let reason: string = first.errorClass || first.stage;
    if (first.stage === "committed" && first.committed) {
      // Only a released decision is actionable: publish the signed receipt,
      // read the checkpoint acknowledgement, release, then gate on allowed().
      const receiptWire = await store.publishV2Receipt(first.committed.claimID(), first.committed.receiptBody());
      const result = await releaseV2Decision(first.committed, receiptWire, {
        verifierPublicKey: keys.verifier.keys.publicKey,
        logID: LOG_ID,
        claimStore: store,
        checkpoint: store,
      });
      released = result.status === "released" && result.decision !== null;
      if (released && result.decision) {
        reason = result.decision.reason();
        allowed = await result.decision.allowed(store);
      } else {
        reason = `release ${result.status}`;
      }
    }

    // A copied request presents the same proof again. It is a replay and is
    // never evaluated.
    store.setTime(now + 1);
    const replay = input.scenario === "replay" && allowed ? await verify() : null;
    const authorityCount = allowed ? this.increment("authority") : this.count("authority");

    const authorityDecision: LaneDecision = {
      lane: "authority",
      allowed,
      reason: replay && allowed
        ? "first call executed; copied request stopped"
        : allowed ? "exact principal mandate verified and released" : (reasonText[reason] ?? reason),
      handlerRan: allowed,
      handlerInvocations: authorityCount,
      checks: [
        { label: "Hybrid signature", passed: first.stage === "committed" && reason !== "proof_invalid", detail: "Ed25519 + ML-DSA-65" },
        { label: "Trusted principal", passed: delegation.issuer_id === keys.root.id && reason !== "not_delegated", detail: "receiver-pinned root key" },
        { label: "Mandated operation", passed: reason !== "scope_denied", detail: proposal.operation },
        { label: "Mandated customer path", passed: reason !== "constraint_denied", detail: proposal.path },
        { label: "Fresh and single-use", passed: first.disposition === "created" && (replay === null || replay.stage !== "replay"), detail: "receiver challenge" },
        { label: "Not revoked", passed: reason !== "delegation_revoked", detail: "signed status list" },
        { label: "Released", passed: released, detail: "signed receipt acknowledged" },
      ],
    };

    return {
      scenario: input.scenario,
      ticket: scenario.ticket,
      classification: input.classification,
      proposal,
      mandate: {
        principal: keys.root.id,
        agent: keys.agent.id,
        operation: "data:write",
        resource: TENANT_RESOURCE,
        path: delegation.constraints?.[0]?.path_prefix ?? "",
        expiresAt: delegation.expires_at,
      },
      access,
      authority: authorityDecision,
      disclosure: "Ratify verifies authority, not classifier correctness. The receiver reconstructs and enforces the proposed operation.",
    };
  }
}
