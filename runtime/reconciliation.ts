import { deriveClientOrderRef } from "./idempotency.js";
import { runOkxJson } from "./okx.js";
import type { ExecutionPlane, OkxCommandIntent } from "./types.js";

export type ReconcileSource = "auto" | "client-id" | "fallback";
export type HistoryMatchStatus = "matched" | "ambiguous" | "not_found" | "query_failed";

export interface HistoryMatchOutcome {
  status: HistoryMatchStatus;
  matchedBy: "client_order_ref" | "fallback_window" | "none";
  reason: string;
  evidence: string[];
  remoteOrderId?: string;
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
  return value > 10_000_000_000 ? value : value * 1_000;
}

async function matchByClientOrderRef(
  intent: OkxCommandIntent,
  plane: ExecutionPlane,
): Promise<HistoryMatchOutcome> {
  const clientOrderRef = deriveClientOrderRef(intent);
  if (!clientOrderRef) {
    return {
      status: "not_found",
      matchedBy: "none",
      reason: "clientOrderRef is missing on this intent.",
      evidence: [],
    };
  }

  const query = await runOkxJson<unknown>(["trade", "orders-history", "--clOrdId", clientOrderRef], plane);
  const evidence = [`client-id query: ${query.command}`];
  if (!query.ok) {
    return {
      status: "query_failed",
      matchedBy: "client_order_ref",
      reason: query.reason ?? "client-id query failed",
      evidence,
    };
  }

  const rows = orderRows(query.data);
  if (rows.length === 1) {
    const ordId = rows[0].ordId;
    return {
      status: "matched",
      matchedBy: "client_order_ref",
      reason: "Matched by clientOrderRef.",
      evidence,
      remoteOrderId: typeof ordId === "string" ? ordId : undefined,
    };
  }
  if (rows.length > 1) {
    return {
      status: "ambiguous",
      matchedBy: "client_order_ref",
      reason: "Multiple orders matched the same clientOrderRef.",
      evidence,
    };
  }
  return {
    status: "not_found",
    matchedBy: "client_order_ref",
    reason: "No order matched by clientOrderRef.",
    evidence,
  };
}

async function matchByFallbackWindow(
  intent: OkxCommandIntent,
  plane: ExecutionPlane,
  startedAtIso: string | undefined,
  windowMin: number,
): Promise<HistoryMatchOutcome> {
  const instId = readIntentFlag(intent, "instId");
  if (!instId) {
    return {
      status: "not_found",
      matchedBy: "none",
      reason: "intent is missing --instId.",
      evidence: [],
    };
  }

  const query = await runOkxJson<unknown>(["trade", "orders-history", "--instId", instId], plane);
  const evidence = [`fallback query: ${query.command}`];
  if (!query.ok) {
    return {
      status: "query_failed",
      matchedBy: "fallback_window",
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
      matchedBy: "fallback_window",
      reason: "Matched by fallback fields (instId+side+size+window).",
      evidence,
      remoteOrderId: typeof ordId === "string" ? ordId : undefined,
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      matchedBy: "fallback_window",
      reason: "Fallback matching returned multiple candidates.",
      evidence,
    };
  }
  return {
    status: "not_found",
    matchedBy: "fallback_window",
    reason: "No order matched fallback fields in configured window.",
    evidence,
  };
}

export async function matchIntentAgainstHistory(
  intent: OkxCommandIntent,
  plane: ExecutionPlane,
  startedAtIso: string | undefined,
  source: ReconcileSource,
  windowMin: number,
): Promise<HistoryMatchOutcome> {
  if (source === "client-id") {
    return matchByClientOrderRef(intent, plane);
  }
  if (source === "fallback") {
    return matchByFallbackWindow(intent, plane, startedAtIso, windowMin);
  }

  const client = await matchByClientOrderRef(intent, plane);
  if (client.status === "matched" || client.status === "ambiguous") {
    return client;
  }

  const fallback = await matchByFallbackWindow(intent, plane, startedAtIso, windowMin);
  return {
    ...fallback,
    evidence: [
      ...client.evidence,
      `client-id ${client.status}: ${client.reason}`,
      ...fallback.evidence,
    ],
  };
}
