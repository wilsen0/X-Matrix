import { putArtifact } from "../../runtime/artifacts.js";
import type {
  GoalIntake,
  PolicyDecision,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";

interface LiveGuardArtifact {
  runId: string;
  plane: SkillContext["plane"];
  checkedAt: string;
  status: "allowed" | "blocked";
  executeRequested: boolean;
  reasons: string[];
  nextAction: string;
  checks: {
    approveFlag: boolean;
    approvedBy: boolean;
    liveConfirm: boolean;
    maxOrderUsdValid: boolean;
    maxTotalUsdValid: boolean;
    doctorFresh: boolean;
  };
}

function now(): string {
  return new Date().toISOString();
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function readDoctorCheckedAt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) {
    return null;
  }
  return new Date(ts).toISOString();
}

function recentEnough(iso: string | null, maxAgeMs: number): boolean {
  if (!iso) {
    return false;
  }
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts <= maxAgeMs;
}

function policyDecision(context: SkillContext): PolicyDecision {
  return (
    context.artifacts.get<PolicyDecision>("execution.apply-decision")?.data ??
    context.artifacts.require<PolicyDecision>("policy.plan-decision").data
  );
}

function approvalProvided(context: SkillContext): boolean {
  return context.runtimeInput.approvalProvided === true || context.runtimeInput.approve === true;
}

function applyCommand(runId: string, plane: SkillContext["plane"], extra: string[] = []): string {
  return [
    "node dist/bin/trademesh.js apply",
    runId,
    "--plane",
    plane,
    "--approve",
    "--approved-by <name>",
    ...extra,
    "--execute",
  ].join(" ");
}

function nextActionForReasons(
  runId: string,
  plane: SkillContext["plane"],
  reasons: string[],
): string {
  if (reasons.some((reason) => reason.includes("doctor --probe active --plane live"))) {
    return "node dist/bin/trademesh.js doctor --probe active --plane live";
  }

  if (reasons.some((reason) => reason.includes("--live-confirm"))) {
    return applyCommand(runId, plane, [
      "--live-confirm YES_LIVE_EXECUTION",
      "--max-order-usd <n>",
      "--max-total-usd <n>",
    ]);
  }

  return applyCommand(runId, plane);
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const executeRequested = context.runtimeInput.executeRequested === true;
  const liveExecute = context.plane === "live" && executeRequested;
  const policy = policyDecision(context);
  const goalIntake = context.artifacts.get<GoalIntake>("goal.intake")?.data;
  const approvedBy = typeof context.runtimeInput.approvedBy === "string" && context.runtimeInput.approvedBy.trim().length > 0;
  const approvalFlag = approvalProvided(context);
  const liveConfirm = context.runtimeInput.liveConfirm === "YES_LIVE_EXECUTION";
  const maxOrderUsd = toPositiveNumber(context.runtimeInput.maxOrderUsd);
  const maxTotalUsd = toPositiveNumber(context.runtimeInput.maxTotalUsd);
  const doctorCheckedAt = readDoctorCheckedAt(context.runtimeInput.doctorCheckedAt);
  const doctorFresh = recentEnough(doctorCheckedAt, 15 * 60 * 1_000);
  const reasons: string[] = [];

  if (liveExecute) {
    if (!approvalFlag) {
      reasons.push("live execute requires --approve.");
    }
    if (!approvedBy) {
      reasons.push("live execute requires --approved-by <name>.");
    }
    if (!liveConfirm) {
      reasons.push("live execute requires --live-confirm YES_LIVE_EXECUTION.");
    }
    if (maxOrderUsd === null) {
      reasons.push("live execute requires --max-order-usd <positive number>.");
    }
    if (maxTotalUsd === null) {
      reasons.push("live execute requires --max-total-usd <positive number>.");
    }
    const maxSingle = policy.budgetSnapshot?.maxSingleOrderUsd;
    const maxTotal = policy.budgetSnapshot?.maxTotalOrderUsd ?? policy.budgetSnapshot?.maxTotalExposureUsd;
    if (maxOrderUsd !== null && typeof maxSingle === "number" && maxOrderUsd > maxSingle) {
      reasons.push(`--max-order-usd exceeds policy limit (${maxSingle}).`);
    }
    if (maxTotalUsd !== null && typeof maxTotal === "number" && maxTotalUsd > maxTotal) {
      reasons.push(`--max-total-usd exceeds policy limit (${maxTotal}).`);
    }
    if (!doctorFresh) {
      reasons.push("live execute requires doctor --probe active --plane live within 15 minutes.");
    }
  }

  const artifact: LiveGuardArtifact = {
    runId: context.runId,
    plane: context.plane,
    checkedAt: now(),
    status: reasons.length === 0 ? "allowed" : "blocked",
    executeRequested,
    reasons,
    nextAction: reasons.length > 0
      ? nextActionForReasons(context.runId, context.plane, reasons)
      : applyCommand(context.runId, context.plane),
    checks: {
      approveFlag: approvalFlag,
      approvedBy,
      liveConfirm,
      maxOrderUsdValid: maxOrderUsd !== null,
      maxTotalUsdValid: maxTotalUsd !== null,
      doctorFresh,
    },
  };

  putArtifact(context.artifacts, {
    key: "operations.live-guard",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: artifact,
    ruleRefs: policy.ruleRefs ?? [],
    doctrineRefs: policy.doctrineRefs ?? [],
  });

  return {
    skill: "live-guard",
    stage: "executor",
    goal: context.goal,
    summary: "Gate live supervised execution with explicit human confirmation, bounded notional limits, and fresh doctor probe evidence.",
    facts: [
      `Plane: ${context.plane}.`,
      `Execute requested: ${executeRequested ? "yes" : "no"}.`,
      `Live guard status: ${artifact.status}.`,
      `Doctor fresh: ${artifact.checks.doctorFresh ? "yes" : "no"}.`,
      `Intent: ${goalIntake?.hedgeIntent ?? "unspecified"}.`,
    ],
    constraints: {
      status: artifact.status,
      reasons,
      checks: artifact.checks,
      nextAction: artifact.nextAction,
    },
    proposal: [],
    risk: {
      score: artifact.status === "blocked" ? 0.9 : 0.25,
      maxLoss: "No write is executed by live-guard.",
      needsApproval: artifact.status === "blocked",
      reasons: artifact.status === "blocked" ? reasons : ["Live guard conditions satisfied."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: artifact.status === "allowed" ? "idempotency-gate" : null,
    handoffReason: artifact.status === "allowed"
      ? "Live guard checks passed."
      : "Execution blocked by live safety guard.",
    producedArtifacts: ["operations.live-guard"],
    consumedArtifacts: ["goal.intake", "policy.plan-decision", "diagnostics.readiness"],
    ruleRefs: policy.ruleRefs ?? [],
    doctrineRefs: policy.doctrineRefs ?? [],
    metadata: {
      artifact,
    },
    timestamp: now(),
  };
}
