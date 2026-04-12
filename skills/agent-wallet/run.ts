import { putArtifact } from "../../runtime/artifacts.js";
import type { AgentWalletIdentity, SkillContext, SkillOutput } from "../../runtime/types.js";

const DEMO_WALLET = "0x000000000000000000000000000000000000dEaD";
const RESEARCH_WALLET = "0x0000000000000000000000000000000000000001";

function resolveWallet(context: SkillContext): AgentWalletIdentity {
  const now = new Date().toISOString();

  // Priority 1: runtimeInput.walletAddress
  if (typeof context.runtimeInput.walletAddress === "string" && context.runtimeInput.walletAddress.trim().length > 0) {
    return {
      walletAddress: context.runtimeInput.walletAddress.trim(),
      chain: "xlayer",
      source: "runtime-input",
      resolvedAt: now,
    };
  }

  // Priority 2: environment variable
  const envWallet = process.env.SKILLS_MESH_AGENT_WALLET;
  if (typeof envWallet === "string" && envWallet.trim().length > 0) {
    return {
      walletAddress: envWallet.trim(),
      chain: "xlayer",
      source: "env",
      resolvedAt: now,
    };
  }

  // Priority 3: demo / research fallback
  const isDemoOrResearch = context.plane === "demo" || context.plane === "research";
  return {
    walletAddress: isDemoOrResearch ? DEMO_WALLET : RESEARCH_WALLET,
    chain: "xlayer",
    source: isDemoOrResearch ? "demo-fallback" : "research-fallback",
    resolvedAt: now,
  };
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const identity = resolveWallet(context);

  putArtifact(context.artifacts, {
    key: "identity.agent-wallet",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: identity,
    ruleRefs: [],
    doctrineRefs: [],
  });

  return {
    skill: "agent-wallet",
    stage: "sensor",
    goal: context.goal,
    summary: `Resolved agent wallet identity via ${identity.source}: ${identity.walletAddress}`,
    facts: [
      `Wallet address: ${identity.walletAddress}`,
      `Chain: ${identity.chain}`,
      `Source: ${identity.source}`,
    ],
    constraints: {
      walletAddress: identity.walletAddress,
      chain: identity.chain,
      source: identity.source,
    },
    proposal: [],
    risk: {
      score: 0.05,
      maxLoss: "n/a",
      needsApproval: false,
      reasons: [],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: false,
      allowedModules: [],
    },
    handoff: "official-executor",
    handoffReason: "Wallet identity resolved; executor can now route on-chain actions.",
    producedArtifacts: ["identity.agent-wallet"],
    consumedArtifacts: [],
    ruleRefs: [],
    doctrineRefs: [],
    metadata: {
      identity,
    },
    timestamp: new Date().toISOString(),
  };
}
