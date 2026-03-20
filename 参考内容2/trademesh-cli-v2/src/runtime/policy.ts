import { PolicyDecision, ProposalOption, RunRecord } from "./types.js";

export function evaluatePolicy(run: RunRecord, proposal: ProposalOption, approvalProvided: boolean): PolicyDecision {
  const reasons: string[] = [];
  const writes = proposal.intents.some((intent) => intent.requiresWrite);

  if (run.permissions.plane === "research" && writes) {
    reasons.push("research plane blocks all write intents");
    return { outcome: "blocked", reasons };
  }

  for (const intent of proposal.intents) {
    if (!run.permissions.allowedModules.includes(intent.module)) {
      reasons.push(`required module '${intent.module}' is not allowed in this plane`);
    }
  }
  if (reasons.length > 0) {
    return { outcome: "blocked", reasons };
  }

  if (run.permissions.plane === "live" && writes && !approvalProvided) {
    reasons.push("live write path requires explicit --approve");
    return { outcome: "require_approval", reasons };
  }

  if (run.risk.needsApproval && run.permissions.plane !== "research" && !approvalProvided) {
    reasons.push("risk gate requires approval for non-research execution");
    return { outcome: "require_approval", reasons };
  }

  reasons.push("policy gate approved this proposal");
  return { outcome: "approved", reasons };
}
