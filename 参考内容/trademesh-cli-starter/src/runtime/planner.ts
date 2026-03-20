import { buildOkxCommandIntents } from "./okx.js";
import { PermissionBlock, ProposalOption, RiskBlock, RunRecord, SkillStep } from "./types.js";

function makeId(): string {
  return `run_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

export function buildRun(goal: string, chain: string[]): RunRecord {
  const plane = /live/i.test(goal) ? "live" : /demo/i.test(goal) ? "demo" : "research";
  const intents = buildOkxCommandIntents(goal, plane);

  const steps: SkillStep[] = chain.map((skill) => ({
    skill,
    summary: {
      "portfolio-xray": "Summarize balance, positions, fee drag, and concentration.",
      "market-scan": "Read market state, volatility, and funding context.",
      "hedge-planner": "Generate hedge alternatives and choose the least destructive protection path.",
      "policy-gate": "Block unsafe writes and enforce demo-first or approval rules.",
      "official-executor": "Translate approved proposal into official okx CLI intents.",
      "replay": "Save trace for audit and future review.",
    }[skill] ?? "Execute generic skill step.",
  }));

  const proposals: ProposalOption[] = [
    {
      name: "light-perp-hedge",
      reason: "Fast downside protection with low upfront cost.",
      estimatedCost: "funding + spread",
      estimatedProtection: "partial",
      cliIntents: intents.filter((intent) => !intent.module.includes("option")).map((intent) => intent.command),
    },
    {
      name: "protective-put",
      reason: "Capped downside with known premium expense.",
      estimatedCost: "option premium",
      estimatedProtection: "strong",
      cliIntents: intents.map((intent) => intent.command),
    },
    {
      name: "collar",
      reason: "Reduce premium outlay by giving up some upside.",
      estimatedCost: "low net premium",
      estimatedProtection: "strong with capped upside",
      cliIntents: intents.map((intent) => intent.command.replace("buy", "sell")),
    },
  ];

  const risk: RiskBlock = {
    score: plane === "live" ? 0.63 : 0.18,
    needsApproval: plane !== "research",
    reasons:
      plane === "live"
        ? ["live capital involved", "derivatives write path", "human approval required"]
        : plane === "demo"
          ? ["simulated write path", "safe for rehearsal"]
          : ["no write execution in research mode"],
  };

  const permissions: PermissionBlock = {
    plane,
    officialWriteOnly: true,
    allowedModules: plane === "research" ? ["market", "account"] : ["market", "account", "option"],
  };

  return {
    id: makeId(),
    goal,
    createdAt: new Date().toISOString(),
    chain,
    steps,
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
    approved: plane === "research",
  };
}
