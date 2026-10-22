// RATIFY_V2_PIN: this file imports the Protocol v2 TypeScript SDK from the
// vendored local build in vendor/. Switch package.json to the published
// 2.0.0-beta.1 package at release.
import {
  CONSTRAINT_RESOURCE_PATH_V2,
  hybridKeypairFromSeeds,
  keyIDV2,
  signDelegationCertV2,
  signProofBundleV2,
  type DelegationCertV2,
  type HybridKeyPairV2,
  type ProofBundleV2,
} from "@identities-ai/ratify-protocol/v2";
import { AUTHORIZED_PATH, TENANT_RESOURCE } from "./operation";

function seed(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

const unsigned = { ed25519: new Uint8Array(0), ml_dsa_65: new Uint8Array(0) };

export interface DemoKey {
  id: string;
  keys: HybridKeyPairV2;
}

export interface DemoKeys {
  root: DemoKey;
  agent: DemoKey;
  /** The root's status key. Separate from the root key that issues delegations. */
  status: DemoKey;
  /** The receiver's key. It signs verification receipts. */
  verifier: DemoKey;
}

async function demoKey(edSeed: number, mlSeed: number): Promise<DemoKey> {
  const keys = await hybridKeypairFromSeeds(seed(edSeed), seed(mlSeed));
  return { id: keyIDV2(keys.publicKey), keys };
}

// Fixed public demo identities. They are not secrets and must never be used
// outside this reference.
export async function demoKeys(): Promise<DemoKeys> {
  return {
    root: await demoKey(31, 32),
    agent: await demoKey(41, 42),
    status: await demoKey(51, 52),
    verifier: await demoKey(61, 62),
  };
}

export async function issueDemoDelegation(
  keys: DemoKeys,
  now: number,
  certSuffix: string,
  expiresInSeconds = 600,
): Promise<DelegationCertV2> {
  return signDelegationCertV2({
    version: 2,
    cert_id: `classifier-demo-${certSuffix}`,
    issuer_id: keys.root.id,
    issuer_pub_key: keys.root.keys.publicKey,
    subject_id: keys.agent.id,
    subject_pub_key: keys.agent.keys.publicKey,
    scope: ["data:write"],
    constraints: [{
      type: CONSTRAINT_RESOURCE_PATH_V2,
      resource_id: TENANT_RESOURCE,
      path_prefix: AUTHORIZED_PATH,
    }],
    issued_at: now,
    expires_at: now + expiresInSeconds,
    signature: unsigned,
  }, keys.root.keys);
}

export async function presentAuthority(
  keys: DemoKeys,
  delegation: DelegationCertV2,
  challenge: { value: Uint8Array; issuedAt: number },
  sessionContext: Uint8Array,
): Promise<ProofBundleV2> {
  return signProofBundleV2({
    version: 2,
    verifier_id: keys.verifier.id,
    agent_id: keys.agent.id,
    agent_pub_key: keys.agent.keys.publicKey,
    delegations: [delegation],
    delegation_digest: new Uint8Array(0),
    challenge: challenge.value,
    challenge_at: challenge.issuedAt,
    challenge_sig: unsigned,
    session_context: sessionContext,
    stream_id: null,
    stream_seq: null,
  }, keys.agent.keys);
}
