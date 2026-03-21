import { existsSync, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getProjectPaths } from "./paths.js";
import type {
  ExecutionPlane,
  IdempotencyLedger,
  IdempotencyLedgerEntry,
  OkxCommandIntent,
} from "./types.js";

const LEDGER_VERSION = 2 as const;
const LEDGER_FILE = "idempotency.json";

interface WriteIntentIdentity {
  instId: string;
  side: string;
  sz: string;
  px: string;
  reduceOnly: string;
  clientOrderRef: string;
}

export interface IdempotencyCheckResult {
  fingerprint: string;
  status: "miss" | "executed_hit" | "pending" | "ambiguous";
  entry?: IdempotencyLedgerEntry;
}

function ledgerPath(): string {
  const { meshLedgersRoot } = getProjectPaths();
  return join(meshLedgersRoot, LEDGER_FILE);
}

async function ensureLedgerDirectory(): Promise<void> {
  const { meshLedgersRoot } = getProjectPaths();
  if (!existsSync(meshLedgersRoot)) {
    await fs.mkdir(meshLedgersRoot, { recursive: true });
  }
}

function now(): string {
  return new Date().toISOString();
}

function parseIntentFlags(intent: OkxCommandIntent): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < intent.args.length; index += 1) {
    const token = intent.args[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = intent.args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
      continue;
    }
    flags.set(key, true);
  }
  return flags;
}

export function deriveClientOrderRef(intent: OkxCommandIntent): string | undefined {
  if (typeof intent.clientOrderRef === "string" && intent.clientOrderRef.trim().length > 0) {
    return intent.clientOrderRef.trim();
  }

  const flags = parseIntentFlags(intent);
  const clOrdId = flags.get("clOrdId");
  if (typeof clOrdId === "string" && clOrdId.trim().length > 0) {
    return clOrdId.trim();
  }

  return undefined;
}

function normalizeWriteIntentIdentity(intent: OkxCommandIntent): WriteIntentIdentity {
  const flags = parseIntentFlags(intent);
  const read = (key: string): string => {
    const value = flags.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const readBool = (key: string): string => {
    const value = flags.get(key);
    if (value === true) {
      return "true";
    }
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      if (lowered === "true" || lowered === "1" || lowered === "yes") {
        return "true";
      }
      if (lowered === "false" || lowered === "0" || lowered === "no") {
        return "false";
      }
    }
    return "";
  };

  return {
    instId: read("instId"),
    side: read("side"),
    sz: read("sz"),
    px: read("px"),
    reduceOnly: readBool("reduceOnly"),
    clientOrderRef: deriveClientOrderRef(intent) ?? "",
  };
}

export function fingerprintWriteIntent(intent: OkxCommandIntent, plane: ExecutionPlane): string {
  const identity = normalizeWriteIntentIdentity(intent);
  const base = [
    plane,
    intent.module,
    identity.instId,
    identity.side,
    identity.sz,
    identity.px,
    identity.reduceOnly,
    identity.clientOrderRef,
  ].join("|");
  return createHash("sha256").update(base).digest("hex");
}

function defaultLedger(): IdempotencyLedger {
  return {
    version: LEDGER_VERSION,
    updatedAt: now(),
    entries: {},
  };
}

export async function loadIdempotencyLedger(): Promise<IdempotencyLedger> {
  await ensureLedgerDirectory();
  const path = ledgerPath();
  if (!existsSync(path)) {
    return defaultLedger();
  }

  const raw = await fs.readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return defaultLedger();
  }

  const record = parsed as Partial<IdempotencyLedger>;
  if (record.version !== LEDGER_VERSION || !record.entries || typeof record.entries !== "object") {
    return defaultLedger();
  }

  return {
    version: LEDGER_VERSION,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now(),
    entries: record.entries as IdempotencyLedger["entries"],
  };
}

async function saveLedger(ledger: IdempotencyLedger): Promise<void> {
  await ensureLedgerDirectory();
  const path = ledgerPath();
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, path);
}

export async function checkWriteIntentIdempotency(
  intent: OkxCommandIntent,
  plane: ExecutionPlane,
): Promise<IdempotencyCheckResult> {
  const ledger = await loadIdempotencyLedger();
  const fingerprint = fingerprintWriteIntent(intent, plane);
  const entry = ledger.entries[fingerprint];
  if (!entry) {
    return {
      fingerprint,
      status: "miss",
    };
  }

  if (entry.status === "executed") {
    return {
      fingerprint,
      status: "executed_hit",
      entry,
    };
  }

  if (entry.status === "ambiguous") {
    return {
      fingerprint,
      status: "ambiguous",
      entry,
    };
  }

  return {
    fingerprint,
    status: "pending",
    entry,
  };
}

export async function markWriteIntentPending(input: {
  fingerprint: string;
  intent: OkxCommandIntent;
  runId: string;
  proposal: string;
  plane: ExecutionPlane;
}): Promise<IdempotencyLedgerEntry> {
  const ledger = await loadIdempotencyLedger();
  const current = ledger.entries[input.fingerprint];
  const timestamp = now();
  const next: IdempotencyLedgerEntry = {
    fingerprint: input.fingerprint,
    intentId: input.intent.intentId,
    runId: input.runId,
    proposal: input.proposal,
    plane: input.plane,
    module: input.intent.module,
    requiresWrite: input.intent.requiresWrite,
    clientOrderRef: deriveClientOrderRef(input.intent),
    command: input.intent.command,
    status: "pending",
    remoteOrderId: current?.remoteOrderId,
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastError: undefined,
  };
  ledger.entries[input.fingerprint] = next;
  ledger.updatedAt = timestamp;
  await saveLedger(ledger);
  return next;
}

export async function markWriteIntentExecuted(input: {
  fingerprint: string;
  remoteOrderId?: string;
}): Promise<IdempotencyLedgerEntry | null> {
  const ledger = await loadIdempotencyLedger();
  const current = ledger.entries[input.fingerprint];
  if (!current) {
    return null;
  }

  const timestamp = now();
  const next: IdempotencyLedgerEntry = {
    ...current,
    status: "executed",
    remoteOrderId: input.remoteOrderId ?? current.remoteOrderId,
    updatedAt: timestamp,
    lastError: undefined,
  };
  ledger.entries[input.fingerprint] = next;
  ledger.updatedAt = timestamp;
  await saveLedger(ledger);
  return next;
}

export async function markWriteIntentAmbiguous(input: {
  fingerprint: string;
  lastError: string;
}): Promise<IdempotencyLedgerEntry | null> {
  const ledger = await loadIdempotencyLedger();
  const current = ledger.entries[input.fingerprint];
  if (!current) {
    return null;
  }

  const timestamp = now();
  const next: IdempotencyLedgerEntry = {
    ...current,
    status: "ambiguous",
    updatedAt: timestamp,
    lastError: input.lastError,
  };
  ledger.entries[input.fingerprint] = next;
  ledger.updatedAt = timestamp;
  await saveLedger(ledger);
  return next;
}
