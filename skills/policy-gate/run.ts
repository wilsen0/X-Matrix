import { putArtifact } from "../../runtime/artifacts.js";
import { evaluatePolicy } from "../../runtime/policy.js";
import type {
  GoalIntake,
  PolicyDecision,
  ProposalExecutionReadiness,
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

  const recommended = proposals.find((entry) => entry.recommended);
  if (recommended) {
    return recommended;
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

function executionReadiness(
  plane: SkillContext["plane"],
  goalIntake: GoalIntake | undefined,
  decision: PolicyDecision,
  proposal: SkillProposal,
  capabilitySnapshot: Parameters<typeof evaluatePolicy>[0]["capabilitySnapshot"],
): ProposalExecutionReadiness {
  if (decision.outcome === "blocked") {
    return "policy_blocked";
  }

  const wantsExecute = goalIntake?.executePreference === "execute";
  const hasEnvGap = (decision.capabilityGaps ?? []).some((gap) =>
    ["okx-cli", "okx-config", "demo-profile", "live-profile"].includes(gap.id),
  );

  if (
    plane === "demo" &&
    decision.outcome === "approved" &&
    capabilitySnapshot?.okxCliAvailable &&
    capabilitySnapshot.configExists &&
    capabilitySnapshot.demoProfileLikelyConfigured
  ) {
    return "ready_for_demo_execute";
  }

  if (wantsExecute && hasEnvGap && (proposal.orderPlan?.length ?? 0) > 0) {
    return "env_missing";
  }

  return "ready_for_dry_run";
}

function annotatedRejectionReason(
  proposal: SkillProposal,
  readiness: ProposalExecutionReadiness,
  decision: PolicyDecision,
): string | undefined {
  if (proposal.recommended) {
    return undefined;
  }
  if (readiness === "policy_blocked") {
    return decision.reasons[0] ?? proposal.rejectionReason;
  }
  if (readiness === "env_missing") {
    return decision.capabilityGaps?.[0]?.message ?? proposal.rejectionReason;
  }
  return proposal.rejectionReason;
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const baseProposals = context.artifacts.require<SkillProposal[]>("planning.proposals").data;
  const goalIntake = context.artifacts.get<GoalIntake>("goal.intake")?.data;
  const capabilitySnapshot =
    (context.runtimeInput.capabilitySnapshot as Parameters<typeof evaluatePolicy>[0]["capabilitySnapshot"]) ??
    undefined;
  const annotated = await Promise.all(
    baseProposals.map(async (proposal) => {
      const evaluation = await evaluatePolicy({
        phase: "plan",
        artifacts: context.artifacts,
        proposal,
        plane: context.plane,
        approvalProvided: false,
        executeRequested: false,
        capabilitySnapshot,
      });
      const readiness = executionReadiness(
        context.plane,
        goalIntake,
        evaluation,
        proposal,
        capabilitySnapshot,
      );

      return {
        proposal: {
          ...proposal,
          actionable: readiness === "ready_for_dry_run" || readiness === "ready_for_demo_execute",
          executionReadiness: readiness,
          capabilityGaps: evaluation.capabilityGaps ?? [],
        } satisfies SkillProposal,
        decision: evaluation,
      };
    }),
  );
  const recommendedName =
    annotated.find((entry) => entry.proposal.actionable)?.proposal.name ??
    annotated[0]?.proposal.name;
  const proposals = annotated.map((entry) => ({
    ...entry.proposal,
    recommended: entry.proposal.name === recommendedName,
    rejectionReason:
      entry.proposal.name === recommendedName
        ? undefined
        : annotatedRejectionReason(entry.proposal, entry.proposal.executionReadiness!, entry.decision),
  }));
  const proposal = chooseProposal(context, proposals);
  const decision = annotated.find((entry) => entry.proposal.name === proposal.name)?.decision ??
    (await evaluatePolicy({
      phase: "plan",
      artifacts: context.artifacts,
      proposal,
      plane: context.plane,
      approvalProvided: false,
      executeRequested: false,
      capabilitySnapshot,
    }));

  putArtifact(context.artifacts, {
    key: "planning.proposals",
    version: context.manifest.artifactVersion,
    producer: "policy-gate",
    data: proposals,
    ruleRefs: decision.ruleRefs ?? [],
    doctrineRefs: decision.doctrineRefs ?? [],
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
      ...proposals.map((entry) =>
        `Actionability ${entry.name}: ${entry.executionReadiness ?? "unknown"}${entry.capabilityGaps?.[0] ? ` (${entry.capabilityGaps[0].message})` : ""}.`,
      ),
      ...decision.reasons.map((reason) => `Reason: ${reason}`),
      ...(decision.capabilityGaps ?? []).map(
        (gap) => `Capability gap [${gap.severity}]: ${gap.message}`,
      ),
    ],
    constraints: {
      selectedProposal: proposal.name,
      requiredModules: proposal.requiredModules ?? allowedModulesForPlane(context.plane),
      decision: decision.outcome,
      breachFlags: decision.breachFlags ?? [],
      budgetSnapshot: decision.budgetSnapshot ?? null,
      capabilityGaps: decision.capabilityGaps ?? [],
      actionabilitySummary: proposals.map((entry) => ({
        name: entry.name,
        actionable: entry.actionable ?? false,
        executionReadiness: entry.executionReadiness ?? "policy_blocked",
      })),
    },
    proposal: proposals,
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
    producedArtifacts: ["planning.proposals", "policy.plan-decision"],
    consumedArtifacts: [
      "goal.intake",
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
      capabilityGaps: decision.capabilityGaps ?? [],
      actionabilitySummary: proposals.map((entry) => ({
        name: entry.name,
        actionable: entry.actionable ?? false,
        executionReadiness: entry.executionReadiness ?? "policy_blocked",
        topGap: entry.capabilityGaps?.[0]?.message ?? null,
      })),
    },
    timestamp: new Date().toISOString(),
  };
}
