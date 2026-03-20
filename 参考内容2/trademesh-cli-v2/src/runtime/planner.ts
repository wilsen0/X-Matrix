import { buildOkxCommandIntents, inspectOkxEnvironment } from "./okx.js";
import { PermissionBlock, Plane, ProposalOption, RiskBlock, RunRecord, SkillStep } from "./types.js";

function makeId(): string {
  return `run_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

export function inferPlane(goal: string, explicitPlane?: Plane): Plane {
  if (explicitPlane) return explicitPlane;
  if (/\blive\b/i.test(goal)) return "live";
  if (/\bdemo\b/i.test(goal)) return "demo";
  return "research";
}

function buildSteps(chain: string[]): SkillStep[] {
  return chain.map((skill) => ({
    skill,
    summary:
      {
        "portfolio-xray": "Summarize balance, positions, fee drag, and concentration.",
        "market-scan": "Read market state, volatility, and liquidity context.",
        "hedge-planner": "Generate hedge alternatives with explicit trade-offs.",
        "policy-gate": "Block unsafe writes and enforce demo-first or approval rules.",
        "official-executor": "Translate approved proposals into official okx CLI intents.",
        replay: "Persist the trace for audit and demo replay.",
      }[skill] ?? "Execute generic skill step.",
  }));
}

function buildProposals(goal: string, plane: Plane): ProposalOption[] {
  const intentsByProposal = buildOkxCommandIntents(goal, plane);
  return Object.entries(intentsByProposal).map(([name, intents]) => ({
    name,
    reason:
      {
        "light-perp-hedge": "Fast downside protection with lower upfront cost than options.",
        "protective-put": "Known premium expense with stronger downside convexity.",
        collar: "Reduced premium outlay by selling upside optionality.",
        observation: "Read-only observation path for research mode.",
      }[name] ?? "General-purpose proposal.",
    estimatedCost:
      {
        "light-perp-hedge": "funding + spread",
        "protective-put": "option premium",
        collar: "low net premium",
        observation: "none",
      }[name] ?? "unknown",
    estimatedProtection:
      {
        "light-perp-hedge": "partial",
        "protective-put": "strong",
        collar: "strong with capped upside",
        observation: "none",
      }[name] ?? "unknown",
    requiredModules: Array.from(new Set(intents.map((intent) => intent.module))),
    intents,
  }));
}

function buildRisk(plane: Plane, hasWriteIntents: boolean): RiskBlock {
  if (plane === "live") {
    return {
      score: hasWriteIntents ? 0.68 : 0.22,
      needsApproval: hasWriteIntents,
      reasons: hasWriteIntents
        ? ["live capital involved", "derivatives or options path", "human approval required"]
        : ["live read path only"],
    };
  }
  if (plane === "demo") {
    return {
      score: hasWriteIntents ? 0.25 : 0.1,
      needsApproval: hasWriteIntents,
      reasons: hasWriteIntents
        ? ["simulated write path", "safe for rehearsal", "still require human checkpoint"]
        : ["demo read path only"],
    };
  }
  return {
    score: 0.08,
    needsApproval: false,
    reasons: ["research mode only", "no write execution allowed"],
  };
}

function buildPermissions(plane: Plane): PermissionBlock {
  return {
    plane,
    officialWriteOnly: true,
    allowedModules: plane === "research" ? ["market", "account"] : ["market", "account", "swap", "option"],
  };
}

export function buildRun(goal: string, chain: string[], plane: Plane): RunRecord {
  const proposals = buildProposals(goal, plane);
  const hasWriteIntents = proposals.some((proposal) => proposal.intents.some((intent) => intent.requiresWrite));
  const permissions = buildPermissions(plane);
  const risk = buildRisk(plane, hasWriteIntents);

  return {
    id: makeId(),
    goal,
    createdAt: new Date().toISOString(),
    status: risk.needsApproval ? "approval_required" : "planned",
    chain,
    steps: buildSteps(chain),
    facts: [
      "Concentration risk should be computed before proposing a hedge.",
      "Market context should be read before any execution proposal.",
      "Write operations should be delegated to official executor only.",
    ],
    constraints: {
      mustDemoFirst: plane !== "live",
      officialWriteOnly: true,
    },
    proposals,
    risk,
    permissions,
    capabilitySnapshot: inspectOkxEnvironment(),
    approved: !risk.needsApproval,
    executions: [],
  };
}
