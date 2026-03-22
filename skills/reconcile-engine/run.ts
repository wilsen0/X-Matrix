import { putArtifact } from "../../runtime/artifacts.js";
import {
  deriveClientOrderRef,
  fingerprintWriteIntent,
  markWriteIntentAmbiguous,
  markWriteIntentExecuted,
} from "../../runtime/idempotency.js";
import { runOkxJson } from "../../runtime/okx.js";
import type {
  ExecutionPlane,
  ExecutionRecord,
  OkxCommandIntent,
  ReconciliationItem,
  ReconciliationReport,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";

type ReconcileSource = "auto" | "client-id" | "fallback";

function now(): string {
  return new Date().toISOString();
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function orderRows(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const record = payload as { data?: unknown };
  if (!Array.isArray(record.data)) {
    return [];
  }
  return record.data
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => entry as Record<string, unknown>);
}

function readIntentFlag(intent: OkxCommandIntent, flagName: string): string | undefined {
  for (let index = 0; index < intent.args.length; index += 1) {
    const token = intent.args[index];
    if (token !== `--${flagName}`) {
      continue;
    }
    const next = intent.args[index + 1];
    if (!next || next.startsWith("--")) {
      return undefined;
    }
    return next;
  }
  return undefined;
}

function orderTimestampMs(order: Record<string, unknown>): number | null {
  const value = toFiniteNumber(order.cTime) ?? toFiniteNumber(order.uTime) ?? toFiniteNumber(order.ts);
  if (value === null) {
    return null;
  }
  if (value > 10_000_000_000) {
    return value;
  }
  return value * 1_000;
}

function executionFromInput(context: SkillContext): ExecutionRecord | null {
  const raw = context.runtimeInput.execution;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as ExecutionRecord;
}

function reconcileSource(context: SkillContext): ReconcileSource {
  const source = context.runtimeInput.reconcileSource;
  if (source === "client-id" || source === "fallback" || source === "auto") {
    return source;
  }
  return "auto";
}

function reconcileWindowMinutes(context: SkillContext): number {
  const raw = toFiniteNumber(context.runtimeInput.reconcileWindowMin);
  if (raw === null || raw <= 0) {
    return 120;
  }
  return raw;
}

function attemptNumber(context: SkillContext): number {
  const raw = toFiniteNumber(context.runtimeInput.attemptNumber);
  if (raw === null || raw <= 0) {
    return 1;
  }
  return Math.floor(raw);
}

async function matchByClientOrderRef(
  intent: OkxCommandIntent,
  plane: ExecutionPlane,
): Promise<{
  status: "matched" | "ambiguous" | "failed";
  reason: string;
  evidence: string[];
  remoteOrderId?: string;
}> {
  const clientOrderRef = deriveClientOrderRef(intent);
  if (!clientOrderRef) {
    return {
      status: "failed",
      reason: "clientOrderRef is missing on this intent.",
      evidence: [],
    };
  }

  const query = runOkxJson<unknown>(["trade", "orders-history", "--clOrdId", clientOrderRef], plane);
  const evidence = [`client-id query: ${query.command}`];
  if (!query.ok) {
    return {
      status: "failed",
      reason: query.reason ?? "client-id query failed",
      evidence,
    };
  }

  const rows = orderRows(query.data);
  if (rows.length === 1) {
    const ordId = rows[0].ordId;
    return {
      status: "matched",
      reason: "Matched by clientOrderRef.",
      evidence,
      remoteOrderId: typeof ordId === "string" ? ordId : undefined,
    };
  }
  if (rows.length > 1) {
    return {
      status: "ambiguous",
      reason: "Multiple orders matched the same clientOrderRef.",
      evidence,
    };
  }
  return {
    status: "failed",
    reason: "No order matched by clientOrderRef.",
    evidence,
  };
}

async function matchByFallbackWindow(
  intent: OkxCommandIntent,
  plane: ExecutionPlane,
  startedAtIso: string | undefined,
  windowMin: number,
): Promise<{
  status: "matched" | "ambiguous" | "failed";
  reason: string;
  evidence: string[];
  remoteOrderId?: string;
}> {
  const instId = readIntentFlag(intent, "instId");
  if (!instId) {
    return {
      status: "failed",
      reason: "intent is missing --instId.",
      evidence: [],
    };
  }

  const query = runOkxJson<unknown>(["trade", "orders-history", "--instId", instId], plane);
  const evidence = [`fallback query: ${query.command}`];
  if (!query.ok) {
    return {
      status: "failed",
      reason: query.reason ?? "fallback query failed",
      evidence,
    };
  }

  const side = (readIntentFlag(intent, "side") ?? "").toLowerCase();
  const size = toFiniteNumber(readIntentFlag(intent, "sz"));
  const baseTs = startedAtIso ? Date.parse(startedAtIso) : Date.now();
  const windowMs = windowMin * 60 * 1_000;
  const candidates = orderRows(query.data).filter((row) => {
    const rowSide = typeof row.side === "string" ? row.side.toLowerCase() : "";
    if (side && rowSide && rowSide !== side) {
      return false;
    }

    const rowSz = toFiniteNumber(row.sz);
    if (size !== null && rowSz !== null && Math.abs(rowSz - size) > 1e-8) {
      return false;
    }

    const ts = orderTimestampMs(row);
    if (Number.isFinite(baseTs) && ts !== null && Math.abs(ts - baseTs) > windowMs) {
      return false;
    }
    return true;
  });

  if (candidates.length === 1) {
    const ordId = candidates[0].ordId;
    return {
      status: "matched",
      reason: "Matched by fallback fields (instId+side+size+window).",
      evidence,
      remoteOrderId: typeof ordId === "string" ? ordId : undefined,
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      reason: "Fallback matching returned multiple candidates.",
      evidence,
    };
  }
  return {
    status: "failed",
    reason: "No order matched fallback fields in configured window.",
    evidence,
  };
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const execution = executionFromInput(context);
  if (!execution || execution.mode !== "execute") {
    throw new Error("reconcile-engine requires latest execute record in runtimeInput.execution.");
  }

  const source = reconcileSource(context);
  const windowMin = reconcileWindowMinutes(context);
  const attempt = attemptNumber(context);
  const writeResults = execution.results.filter((result) => result.intent.requiresWrite);
  const items: ReconciliationItem[] = [];

  for (const result of writeResults) {
    const intent = result.intent;
    const fingerprint = fingerprintWriteIntent(intent, execution.plane);
    const clientOrderRef = deriveClientOrderRef(intent);
    const evidence: string[] = [];

    let outcome:
      | Awaited<ReturnType<typeof matchByClientOrderRef>>
      | Awaited<ReturnType<typeof matchByFallbackWindow>>;
    if (source === "client-id") {
      outcome = await matchByClientOrderRef(intent, execution.plane);
    } else if (source === "fallback") {
      outcome = await matchByFallbackWindow(intent, execution.plane, result.startedAt, windowMin);
    } else {
      const client = await matchByClientOrderRef(intent, execution.plane);
      outcome = client.status === "matched" || client.status === "ambiguous"
        ? client
        : await matchByFallbackWindow(intent, execution.plane, result.startedAt, windowMin);
      evidence.push(...client.evidence);
      if (client.status === "failed") {
        evidence.push(`client-id miss: ${client.reason}`);
      }
    }

    if (outcome.status === "matched") {
      await markWriteIntentExecuted({
        fingerprint,
        remoteOrderId: outcome.remoteOrderId,
      });
    } else if (outcome.status === "ambiguous") {
      await markWriteIntentAmbiguous({
        fingerprint,
        lastError: outcome.reason,
      });
    }

    items.push({
      intentId: intent.intentId,
      module: intent.module,
      fingerprint,
      clientOrderRef,
      status: outcome.status,
      remoteOrderId: outcome.remoteOrderId,
      reason: outcome.reason,
      evidence: [...evidence, ...outcome.evidence],
    });
  }

  const status: ReconciliationReport["status"] =
    items.length === 0 || items.every((item) => item.status === "matched")
      ? "matched"
      : items.some((item) => item.status === "ambiguous")
        ? "ambiguous"
        : "failed";
  const nextActions =
    status === "matched"
      ? ["No additional reconcile action is required."]
      : status === "ambiguous"
        ? ["Review ambiguous matches manually, then rerun reconcile."]
        : ["Inspect exchange records and rerun reconcile when evidence is available."];
  const previousAttempts = context.artifacts.get<ReconciliationReport>("execution.reconciliation")?.data?.attempts ?? [];
  const attempts = [...previousAttempts, {
    attempt,
    at: now(),
    source,
    windowMin,
    status,
  }];

  const report: ReconciliationReport = {
    runId: context.runId,
    reconciledAt: now(),
    status,
    items,
    attempts,
    nextActions,
  };

  putArtifact(context.artifacts, {
    key: "execution.reconciliation",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: report,
  });

  return {
    skill: "reconcile-engine",
    stage: "executor",
    goal: context.goal,
    summary: "Reconcile uncertain write intents with exchange history using client-order-id first matching.",
    facts: [
      `Reconcile source: ${source}.`,
      `Window: ${windowMin} min.`,
      `Write intents: ${writeResults.length}.`,
      `Reconcile status: ${status}.`,
      `Attempt: ${attempt}.`,
    ],
    constraints: {
      source,
      windowMin,
      status,
      nextActions,
    },
    proposal: [],
    risk: {
      score: status === "matched" ? 0.2 : status === "ambiguous" ? 0.7 : 0.8,
      maxLoss: "No new writes are submitted during reconcile.",
      needsApproval: status !== "matched",
      reasons: nextActions,
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: "operator-summarizer",
    handoffReason: "Reconcile report is ready for operator decision.",
    producedArtifacts: ["execution.reconciliation"],
    consumedArtifacts: ["execution.intent-bundle"],
    metadata: {
      report,
    },
    timestamp: now(),
  };
}
