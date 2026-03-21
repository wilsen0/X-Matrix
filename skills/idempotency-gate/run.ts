import { putArtifact } from "../../runtime/artifacts.js";
import { checkWriteIntentIdempotency } from "../../runtime/idempotency.js";
import type {
  ExecutionPlane,
  OkxCommandIntent,
  PolicyDecision,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";

interface IdempotencyCheckItem {
  intentId: string;
  module: string;
  fingerprint: string;
  status: "miss" | "idempotent-hit" | "blocked_reconcile_required";
  ledgerStatus: "none" | "executed" | "pending" | "ambiguous";
  reason: string;
  ledgerSeq: number | null;
}

interface IdempotencyCheckArtifact {
  runId: string;
  checkedAt: string;
  status: "ok" | "blocked_reconcile_required" | "error";
  items: IdempotencyCheckItem[];
  hitCount: number;
  blockedCount: number;
  nextAction: string;
}

function now(): string {
  return new Date().toISOString();
}

function writeIntents(context: SkillContext): OkxCommandIntent[] {
  const bundle = context.artifacts.require<{ intents?: OkxCommandIntent[] }>("execution.intent-bundle").data;
  if (!Array.isArray(bundle.intents)) {
    return [];
  }
  return bundle.intents.filter((intent) => intent.requiresWrite);
}

function decision(context: SkillContext): PolicyDecision {
  return (
    context.artifacts.get<PolicyDecision>("execution.apply-decision")?.data ??
    context.artifacts.require<PolicyDecision>("policy.plan-decision").data
  );
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const executeRequested = context.runtimeInput.executeRequested === true;
  const selectedPlane =
    context.runtimeInput.applyPlane === "research" ||
    context.runtimeInput.applyPlane === "demo" ||
    context.runtimeInput.applyPlane === "live"
      ? (context.runtimeInput.applyPlane as ExecutionPlane)
      : context.plane;
  const policy = decision(context);
  const writes = writeIntents(context);
  const items: IdempotencyCheckItem[] = [];
  let hitCount = 0;
  let blockedCount = 0;

  if (executeRequested && policy.outcome === "approved") {
    for (const intent of writes) {
      const check = await checkWriteIntentIdempotency(intent, selectedPlane);
      if (check.status === "executed_hit") {
        hitCount += 1;
        items.push({
          intentId: intent.intentId,
          module: intent.module,
          fingerprint: check.fingerprint,
          status: "idempotent-hit",
          ledgerStatus: "executed",
          reason: "Fingerprint already executed; write will be skipped.",
          ledgerSeq: check.entry?.seq ?? null,
        });
        continue;
      }

      if (check.status === "pending" || check.status === "ambiguous") {
        blockedCount += 1;
        items.push({
          intentId: intent.intentId,
          module: intent.module,
          fingerprint: check.fingerprint,
          status: "blocked_reconcile_required",
          ledgerStatus: check.status,
          reason: "Fingerprint is not settled in ledger; reconcile is required before execute.",
          ledgerSeq: check.entry?.seq ?? null,
        });
        continue;
      }

      items.push({
        intentId: intent.intentId,
        module: intent.module,
        fingerprint: check.fingerprint,
        status: "miss",
        ledgerStatus: "none",
        reason: "Fingerprint not found in ledger; write can proceed.",
        ledgerSeq: null,
      });
    }
  }

  const status: IdempotencyCheckArtifact["status"] =
    blockedCount > 0
      ? "blocked_reconcile_required"
      : policy.outcome === "approved"
        ? "ok"
        : "error";
  const nextAction =
    status === "blocked_reconcile_required"
      ? `node dist/bin/trademesh.js reconcile ${context.runId}`
      : status === "ok"
        ? `node dist/bin/trademesh.js apply ${context.runId} --plane ${selectedPlane} --approve --approved-by <name> --execute`
        : "Resolve upstream policy/approval blockers before idempotency gate.";

  const artifact: IdempotencyCheckArtifact = {
    runId: context.runId,
    checkedAt: now(),
    status,
    items,
    hitCount,
    blockedCount,
    nextAction,
  };

  putArtifact(context.artifacts, {
    key: "execution.idempotency-check",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: artifact,
    ruleRefs: policy.ruleRefs ?? [],
    doctrineRefs: policy.doctrineRefs ?? [],
  });

  return {
    skill: "idempotency-gate",
    stage: "executor",
    goal: context.goal,
    summary: "Check write-intent fingerprints before execute and block unsettled states that require reconcile.",
    facts: [
      `Execute requested: ${executeRequested ? "yes" : "no"}.`,
      `Write intents checked: ${writes.length}.`,
      `Idempotent hits: ${hitCount}.`,
      `Blocked intents: ${blockedCount}.`,
      `Gate status: ${status}.`,
    ],
    constraints: {
      executeRequested,
      checkedWriteIntents: writes.length,
      hitCount,
      blockedCount,
      status,
      nextAction,
    },
    proposal: [],
    risk: {
      score: blockedCount > 0 ? 0.85 : 0.2,
      maxLoss: "No write is executed by idempotency-gate.",
      needsApproval: blockedCount > 0,
      reasons: blockedCount > 0
        ? ["Unsettled write fingerprints must reconcile before execute."]
        : ["No unsettled fingerprint blockers detected."],
    },
    permissions: {
      plane: selectedPlane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: blockedCount > 0 ? null : "official-executor",
    handoffReason: blockedCount > 0
      ? "Execution is blocked until reconcile settles pending/ambiguous write fingerprints."
      : "Idempotency gate passed for execute.",
    producedArtifacts: ["execution.idempotency-check"],
    consumedArtifacts: ["execution.intent-bundle", "approval.ticket", "execution.apply-decision"],
    ruleRefs: policy.ruleRefs ?? [],
    doctrineRefs: policy.doctrineRefs ?? [],
    metadata: {
      artifact,
    },
    timestamp: now(),
  };
}
