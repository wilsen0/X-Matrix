import { putArtifact } from "../../runtime/artifacts.js";
import { evaluatePolicy } from "../../runtime/policy.js";
import type {
  PolicyDecision,
  SkillContext,
  SkillOutput,
  SkillProposal,
} from "../../runtime/types.js";

function allowedModulesForPlane(plane: SkillContext["plane"]): string[] {
  if (plane === "research") {
    return ["account", "market"];
  }

  return ["account", "market", "swap", "option"];
}

function chooseProposal(context: SkillContext, proposals: SkillProposal[]): SkillProposal {
  const selected = typeof context.runtimeInput.selectedProposal === "string"
    ? context.runtimeInput.selectedProposal
    : null;
  if (selected) {
    const matched = proposals.find((proposal) => proposal.name === selected);
    if (matched) {
      return matched;
    }
  }

  return proposals[0]!;
}

function riskScore(decision: PolicyDecision): number {
  if (decision.outcome === "blocked") {
    return 0.92;
  }
  if (decision.outcome === "require_approval") {
    return 0.66;
  }
  return 0.28;
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const proposals = context.artifacts.require<SkillProposal[]>("planning.proposals").data;
  const proposal = chooseProposal(context, proposals);
  const decision = await evaluatePolicy({
    phase: "plan",
    artifacts: context.artifacts,
    proposal,
    plane: context.plane,
    approvalProvided: false,
    executeRequested: false,
  });

  putArtifact(context.artifacts, {
    key: "policy.plan-decision",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: decision,
    ruleRefs: decision.ruleRefs ?? [],
    doctrineRefs: decision.doctrineRefs ?? [],
  });

  return {
    skill: "policy-gate",
    stage: "guardrail",
    goal: context.goal,
    summary: "Use the canonical shared policy evaluator so plan and apply resolve from the same rule set.",
    facts: [
      `Selected proposal: ${proposal.name}.`,
      `Policy outcome: ${decision.outcome}.`,
      ...decision.reasons.map((reason) => `Reason: ${reason}`),
    ],
    constraints: {
      selectedProposal: proposal.name,
      requiredModules: proposal.requiredModules ?? allowedModulesForPlane(context.plane),
      decision: decision.outcome,
      breachFlags: decision.breachFlags ?? [],
      budgetSnapshot: decision.budgetSnapshot ?? null,
    },
    proposal: [],
    risk: {
      score: riskScore(decision),
      maxLoss: "Policy gate only approves bounded proposals.",
      needsApproval: decision.outcome !== "approved",
      reasons: decision.reasons,
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: proposal.requiredModules ?? allowedModulesForPlane(context.plane),
    },
    handoff: "official-executor",
    handoffReason: "Policy decision is attached as an artifact for apply/execution.",
    producedArtifacts: ["policy.plan-decision"],
    consumedArtifacts: [
      "planning.proposals",
      "planning.scenario-matrix",
      "trade.thesis",
      "portfolio.snapshot",
      "portfolio.risk-profile",
    ],
    ruleRefs: decision.ruleRefs ?? [],
    doctrineRefs: decision.doctrineRefs ?? [],
    metadata: {
      decision: decision.outcome,
      policyNotes: decision.reasons,
      selectedProposal: proposal.name,
      budgetSnapshot: decision.budgetSnapshot ?? null,
    },
    timestamp: new Date().toISOString(),
  };
}
