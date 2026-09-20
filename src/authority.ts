import {
  PROTOCOL_VERSION,
  deriveID,
  hybridKeypairFromSeeds,
  issueDelegation,
  signChallenge,
  type AgentIdentity,
  type DelegationCert,
  type HumanRoot,
  type HybridPrivateKey,
  type ProofBundle,
} from "@identities-ai/ratify-protocol";
import { AUTHORIZED_PATH, TENANT_RESOURCE } from "./operation";

function seed(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

export interface DemoAuthority {
  root: HumanRoot;
  agent: AgentIdentity;
  agentPrivateKey: HybridPrivateKey;
  delegation: DelegationCert;
}

export async function createDemoAuthority(now: number, certSuffix: string, expiresInSeconds = 600): Promise<DemoAuthority> {
  const rootKeys = await hybridKeypairFromSeeds(seed(31), seed(32));
  const agentKeys = await hybridKeypairFromSeeds(seed(41), seed(42));
  const root: HumanRoot = {
    id: deriveID(rootKeys.publicKey),
    public_key: rootKeys.publicKey,
    created_at: now,
  };
  const agent: AgentIdentity = {
    id: deriveID(agentKeys.publicKey),
    public_key: agentKeys.publicKey,
    name: "Acme support automation agent",
    agent_type: "classifier_router",
    created_at: now,
  };
  const delegation: DelegationCert = {
    cert_id: `classifier-demo-${certSuffix}`,
    version: PROTOCOL_VERSION,
    issuer_id: root.id,
    issuer_pub_key: root.public_key,
    subject_id: agent.id,
    subject_pub_key: agent.public_key,
    scope: ["data:write"],
    constraints: [{
      type: "resource_path",
      resource_id: TENANT_RESOURCE,
      path_prefix: AUTHORIZED_PATH,
    }],
    issued_at: now,
    expires_at: now + expiresInSeconds,
    signature: { ed25519: new Uint8Array(), ml_dsa_65: new Uint8Array() },
  };
  await issueDelegation(delegation, rootKeys.privateKey);
  return { root, agent, agentPrivateKey: agentKeys.privateKey, delegation };
}

export async function presentAuthority(
  authority: DemoAuthority,
  challenge: Uint8Array,
  sessionContext: Uint8Array,
  now: number,
): Promise<ProofBundle> {
  return {
    agent_id: authority.agent.id,
    agent_pub_key: authority.agent.public_key,
    delegations: [authority.delegation],
    challenge,
    challenge_at: now,
    challenge_sig: await signChallenge(challenge, now, authority.agentPrivateKey, sessionContext),
    session_context: sessionContext,
  };
}
