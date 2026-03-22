import { constants, existsSync, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getProjectPaths } from "./paths.js";
import type {
  ExecutionPlane,
  IdempotencyEvent,
  IdempotencyLedger,
  IdempotencyLedgerEntry,
  OkxCommandIntent,
} from "./types.js";

const LEDGER_VERSION = 3 as const;
const LOCK_RETRIES = 5;
const LOCK_RETRY_DELAY_MS = 200;
const LOCK_STALE_MS = 120_000;
const COMPACT_EVENT_THRESHOLD = 2_000;
const COMPACT_SIZE_THRESHOLD_BYTES = 5 * 1024 * 1024;

interface WriteIntentIdentity {
  instId: string;
  side: string;
  sz: string;
  px: string;
  reduceOnly: string;
  clientOrderRef: string;
}

interface LedgerLock {
  lockPath: string;
  handle: fs.FileHandle;
}

interface LedgerPaths {
  snapshotPath: string;
  journalPath: string;
  lockPath: string;
}

interface LedgerState {
  ledger: IdempotencyLedger;
  journalEventCount: number;
  journalBytes: number;
}

interface IdempotencyContext {
  ledger: IdempotencyLedger;
  state: LedgerState;
  paths: LedgerPaths;
}

export interface IdempotencyCheckResult {
  fingerprint: string;
  status: "miss" | "executed_hit" | "pending" | "ambiguous";
  entry?: IdempotencyLedgerEntry;
}

export interface IdempotencyClaimResult {
  fingerprint: string;
  status: "claimed" | "executed_hit" | "pending" | "ambiguous";
  entry?: IdempotencyLedgerEntry;
}

export class IdempotencyLockError extends Error {
  readonly nextSafeAction: string;

  constructor(message: string, nextSafeAction: string) {
    super(message);
    this.name = "IdempotencyLockError";
    this.nextSafeAction = nextSafeAction;
  }
}

function now(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ledgerPaths(): LedgerPaths {
  const { meshLedgersRoot } = getProjectPaths();
  return {
    snapshotPath: join(meshLedgersRoot, "idempotency.v3.snapshot.json"),
    journalPath: join(meshLedgersRoot, "idempotency.v3.journal.jsonl"),
    lockPath: join(meshLedgersRoot, "idempotency.v3.lock"),
  };
}

async function ensureLedgerDirectory(): Promise<void> {
  const { meshLedgersRoot } = getProjectPaths();
  if (!existsSync(meshLedgersRoot)) {
    await fs.mkdir(meshLedgersRoot, { recursive: true });
  }
}

function cloneEntry(entry: IdempotencyLedgerEntry): IdempotencyLedgerEntry {
  return {
    ...entry,
  };
}

function emptyLedger(): IdempotencyLedger {
  return {
    version: LEDGER_VERSION,
    nextSeq: 1,
    updatedAt: now(),
    entries: {},
  };
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

function nextSeq(ledger: IdempotencyLedger): number {
  return Number.isFinite(ledger.nextSeq) && ledger.nextSeq > 0 ? ledger.nextSeq : 1;
}

function applyEvent(ledger: IdempotencyLedger, event: IdempotencyEvent): void {
  const timestamp = event.at;
  if (event.kind === "pending") {
    const existing = ledger.entries[event.fingerprint];
    ledger.entries[event.fingerprint] = {
      seq: event.seq,
      fingerprint: event.fingerprint,
      intentId: event.intentId,
      runId: event.runId,
      proposal: event.proposal,
      plane: event.plane,
      module: event.module,
      requiresWrite: event.requiresWrite,
      clientOrderRef: event.clientOrderRef,
      command: event.command,
      status: "pending",
      remoteOrderId: existing?.remoteOrderId,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastError: undefined,
    };
  } else if (event.kind === "executed") {
    const existing = ledger.entries[event.fingerprint];
    if (!existing) {
      return;
    }
    ledger.entries[event.fingerprint] = {
      ...existing,
      seq: event.seq,
      status: "executed",
      updatedAt: timestamp,
      remoteOrderId: event.remoteOrderId ?? existing.remoteOrderId,
      lastError: undefined,
    };
  } else {
    const existing = ledger.entries[event.fingerprint];
    if (!existing) {
      return;
    }
    ledger.entries[event.fingerprint] = {
      ...existing,
      seq: event.seq,
      status: "ambiguous",
      updatedAt: timestamp,
      lastError: event.lastError,
    };
  }

  ledger.nextSeq = Math.max(nextSeq(ledger), event.seq + 1);
  ledger.updatedAt = timestamp;
}

function parseSnapshot(raw: string): IdempotencyLedger {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyLedger();
  }
  const record = parsed as Partial<IdempotencyLedger>;
  if (record.version !== LEDGER_VERSION || !record.entries || typeof record.entries !== "object") {
    return emptyLedger();
  }
  const entries: IdempotencyLedger["entries"] = {};
  for (const [fingerprint, entry] of Object.entries(record.entries)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const value = entry as Partial<IdempotencyLedgerEntry>;
    if (
      typeof value.fingerprint !== "string" ||
      typeof value.intentId !== "string" ||
      typeof value.runId !== "string" ||
      typeof value.proposal !== "string" ||
      (value.status !== "pending" && value.status !== "executed" && value.status !== "ambiguous")
    ) {
      continue;
    }
    entries[fingerprint] = {
      seq: typeof value.seq === "number" && Number.isFinite(value.seq) ? value.seq : 0,
      fingerprint: value.fingerprint,
      intentId: value.intentId,
      runId: value.runId,
      proposal: value.proposal,
      plane: value.plane === "live" || value.plane === "demo" ? value.plane : "research",
      module: typeof value.module === "string" ? value.module : "unknown",
      requiresWrite: value.requiresWrite === true,
      clientOrderRef: typeof value.clientOrderRef === "string" ? value.clientOrderRef : undefined,
      command: typeof value.command === "string" ? value.command : "",
      status: value.status,
      remoteOrderId: typeof value.remoteOrderId === "string" ? value.remoteOrderId : undefined,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : now(),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now(),
      lastError: typeof value.lastError === "string" ? value.lastError : undefined,
    };
  }

  return {
    version: LEDGER_VERSION,
    nextSeq: typeof record.nextSeq === "number" && Number.isFinite(record.nextSeq) && record.nextSeq > 0
      ? record.nextSeq
      : 1,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now(),
    entries,
  };
}

function parseJournalLine(line: string): IdempotencyEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Partial<IdempotencyEvent>;
  if (
    typeof record.seq !== "number" ||
    !Number.isFinite(record.seq) ||
    typeof record.at !== "string" ||
    typeof record.kind !== "string" ||
    (record.kind !== "pending" && record.kind !== "executed" && record.kind !== "ambiguous") ||
    typeof record.fingerprint !== "string"
  ) {
    return null;
  }

  return {
    seq: record.seq,
    at: record.at,
    kind: record.kind,
    fingerprint: record.fingerprint,
    intentId: typeof record.intentId === "string" ? record.intentId : "",
    runId: typeof record.runId === "string" ? record.runId : "",
    proposal: typeof record.proposal === "string" ? record.proposal : "",
    plane: record.plane === "demo" || record.plane === "live" ? record.plane : "research",
    module: typeof record.module === "string" ? record.module : "unknown",
    requiresWrite: record.requiresWrite === true,
    clientOrderRef: typeof record.clientOrderRef === "string" ? record.clientOrderRef : undefined,
    command: typeof record.command === "string" ? record.command : "",
    remoteOrderId: typeof record.remoteOrderId === "string" ? record.remoteOrderId : undefined,
    lastError: typeof record.lastError === "string" ? record.lastError : undefined,
  };
}

async function loadStateFromDisk(paths: LedgerPaths): Promise<LedgerState> {
  let ledger = emptyLedger();
  if (existsSync(paths.snapshotPath)) {
    try {
      const snapshotRaw = await fs.readFile(paths.snapshotPath, "utf8");
      ledger = parseSnapshot(snapshotRaw);
    } catch {
      ledger = emptyLedger();
    }
  }

  let journalEventCount = 0;
  let journalBytes = 0;
  if (existsSync(paths.journalPath)) {
    const journalRaw = await fs.readFile(paths.journalPath, "utf8");
    journalBytes = Buffer.byteLength(journalRaw, "utf8");
    const lines = journalRaw.split(/\r?\n/);
    for (const line of lines) {
      const event = parseJournalLine(line);
      if (!event) {
        continue;
      }
      applyEvent(ledger, event);
      journalEventCount += 1;
    }
  }

  return {
    ledger,
    journalEventCount,
    journalBytes,
  };
}

async function writeSnapshot(paths: LedgerPaths, ledger: IdempotencyLedger): Promise<void> {
  const tempPath = `${paths.snapshotPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(ledger, null, 2)}\n`;
  await fs.writeFile(tempPath, payload, "utf8");
  await fs.rename(tempPath, paths.snapshotPath);
}

async function truncateJournal(paths: LedgerPaths): Promise<void> {
  const tempPath = `${paths.journalPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, "", "utf8");
  await fs.rename(tempPath, paths.journalPath);
}

async function appendEvent(paths: LedgerPaths, event: IdempotencyEvent): Promise<void> {
  const line = `${JSON.stringify(event)}\n`;
  const handle = await fs.open(paths.journalPath, "a");
  try {
    await handle.writeFile(line, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function shouldCompact(state: LedgerState): boolean {
  return state.journalEventCount > COMPACT_EVENT_THRESHOLD || state.journalBytes > COMPACT_SIZE_THRESHOLD_BYTES;
}

async function tryAcquireLock(paths: LedgerPaths): Promise<LedgerLock | null> {
  try {
    const handle = await fs.open(paths.lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await handle.writeFile(`${process.pid}\n${now()}\n`, "utf8");
    await handle.sync();
    return {
      lockPath: paths.lockPath,
      handle,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/EEXIST/.test(message)) {
      throw error;
    }
    return null;
  }
}

async function clearStaleLock(lockPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs < LOCK_STALE_MS) {
      return false;
    }
    await fs.unlink(lockPath);
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(lock: LedgerLock): Promise<void> {
  try {
    await lock.handle.close();
  } catch {
    // no-op
  }
  try {
    await fs.unlink(lock.lockPath);
  } catch {
    // no-op
  }
}

async function acquireLock(paths: LedgerPaths): Promise<LedgerLock> {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    const lock = await tryAcquireLock(paths);
    if (lock) {
      return lock;
    }
    const staleCleared = await clearStaleLock(paths.lockPath);
    if (staleCleared) {
      continue;
    }
    await sleep(LOCK_RETRY_DELAY_MS);
  }

  throw new IdempotencyLockError(
    "Idempotency ledger is locked by another process. apply is blocked to prevent duplicate writes.",
    "retry apply after the competing process exits",
  );
}

async function withLedgerMutation<T>(
  mutation: (context: IdempotencyContext) => Promise<T>,
): Promise<T> {
  await ensureLedgerDirectory();
  const paths = ledgerPaths();
  const lock = await acquireLock(paths);
  try {
    const state = await loadStateFromDisk(paths);
    if (!existsSync(paths.snapshotPath)) {
      await writeSnapshot(paths, state.ledger);
    }
    if (!existsSync(paths.journalPath)) {
      await fs.writeFile(paths.journalPath, "", "utf8");
    }
    const value = await mutation({
      ledger: state.ledger,
      state,
      paths,
    });
    return value;
  } finally {
    await releaseLock(lock);
  }
}

async function appendAndApplyEvent(
  context: IdempotencyContext,
  eventInput: Omit<IdempotencyEvent, "seq" | "at">,
): Promise<IdempotencyEvent> {
  const event: IdempotencyEvent = {
    ...eventInput,
    seq: nextSeq(context.ledger),
    at: now(),
  };
  await appendEvent(context.paths, event);
  applyEvent(context.ledger, event);
  context.state.journalEventCount += 1;
  context.state.journalBytes += Buffer.byteLength(`${JSON.stringify(event)}\n`, "utf8");

  if (shouldCompact(context.state)) {
    await writeSnapshot(context.paths, context.ledger);
    await truncateJournal(context.paths);
    context.state.journalEventCount = 0;
    context.state.journalBytes = 0;
  }

  return event;
}

interface PendingEventInput {
  fingerprint: string;
  intent: OkxCommandIntent;
  runId: string;
  proposal: string;
  plane: ExecutionPlane;
}

function pendingWriteEvent(input: PendingEventInput): Omit<IdempotencyEvent, "seq" | "at"> {
  return {
    kind: "pending",
    fingerprint: input.fingerprint,
    intentId: input.intent.intentId,
    runId: input.runId,
    proposal: input.proposal,
    plane: input.plane,
    module: input.intent.module,
    requiresWrite: input.intent.requiresWrite,
    clientOrderRef: deriveClientOrderRef(input.intent),
    command: input.intent.command,
  };
}

export async function loadIdempotencyLedger(): Promise<IdempotencyLedger> {
  await ensureLedgerDirectory();
  const state = await loadStateFromDisk(ledgerPaths());
  return {
    version: LEDGER_VERSION,
    nextSeq: state.ledger.nextSeq,
    updatedAt: state.ledger.updatedAt,
    entries: Object.fromEntries(
      Object.entries(state.ledger.entries).map(([key, value]) => [key, cloneEntry(value)]),
    ),
  };
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
      entry: cloneEntry(entry),
    };
  }

  if (entry.status === "ambiguous") {
    return {
      fingerprint,
      status: "ambiguous",
      entry: cloneEntry(entry),
    };
  }

  return {
    fingerprint,
    status: "pending",
    entry: cloneEntry(entry),
  };
}

export async function markWriteIntentPending(input: {
  fingerprint: string;
  intent: OkxCommandIntent;
  runId: string;
  proposal: string;
  plane: ExecutionPlane;
}): Promise<IdempotencyLedgerEntry> {
  return withLedgerMutation(async (context) => {
    await appendAndApplyEvent(context, pendingWriteEvent(input));

    const entry = context.ledger.entries[input.fingerprint];
    if (!entry) {
      throw new Error(`Failed to persist pending idempotency entry for '${input.fingerprint}'.`);
    }
    return cloneEntry(entry);
  });
}

export async function claimWriteIntentForExecution(input: {
  intent: OkxCommandIntent;
  runId: string;
  proposal: string;
  plane: ExecutionPlane;
}): Promise<IdempotencyClaimResult> {
  return withLedgerMutation(async (context) => {
    const fingerprint = fingerprintWriteIntent(input.intent, input.plane);
    const current = context.ledger.entries[fingerprint];
    if (current?.status === "executed") {
      return {
        fingerprint,
        status: "executed_hit",
        entry: cloneEntry(current),
      };
    }
    if (current?.status === "pending") {
      return {
        fingerprint,
        status: "pending",
        entry: cloneEntry(current),
      };
    }
    if (current?.status === "ambiguous") {
      return {
        fingerprint,
        status: "ambiguous",
        entry: cloneEntry(current),
      };
    }

    await appendAndApplyEvent(context, pendingWriteEvent({
      fingerprint,
      intent: input.intent,
      runId: input.runId,
      proposal: input.proposal,
      plane: input.plane,
    }));
    const entry = context.ledger.entries[fingerprint];
    if (!entry) {
      throw new Error(`Failed to claim write intent '${input.intent.intentId}' for execution.`);
    }
    return {
      fingerprint,
      status: "claimed",
      entry: cloneEntry(entry),
    };
  });
}

export async function markWriteIntentExecuted(input: {
  fingerprint: string;
  remoteOrderId?: string;
}): Promise<IdempotencyLedgerEntry | null> {
  return withLedgerMutation(async (context) => {
    const current = context.ledger.entries[input.fingerprint];
    if (!current) {
      return null;
    }

    await appendAndApplyEvent(context, {
      kind: "executed",
      fingerprint: input.fingerprint,
      intentId: current.intentId,
      runId: current.runId,
      proposal: current.proposal,
      plane: current.plane,
      module: current.module,
      requiresWrite: current.requiresWrite,
      clientOrderRef: current.clientOrderRef,
      command: current.command,
      remoteOrderId: input.remoteOrderId,
    });

    const entry = context.ledger.entries[input.fingerprint];
    return entry ? cloneEntry(entry) : null;
  });
}

export async function markWriteIntentAmbiguous(input: {
  fingerprint: string;
  lastError: string;
}): Promise<IdempotencyLedgerEntry | null> {
  return withLedgerMutation(async (context) => {
    const current = context.ledger.entries[input.fingerprint];
    if (!current) {
      return null;
    }

    await appendAndApplyEvent(context, {
      kind: "ambiguous",
      fingerprint: input.fingerprint,
      intentId: current.intentId,
      runId: current.runId,
      proposal: current.proposal,
      plane: current.plane,
      module: current.module,
      requiresWrite: current.requiresWrite,
      clientOrderRef: current.clientOrderRef,
      command: current.command,
      lastError: input.lastError,
    });

    const entry = context.ledger.entries[input.fingerprint];
    return entry ? cloneEntry(entry) : null;
  });
}

export function idempotencyLedgerFilePaths(): LedgerPaths {
  return ledgerPaths();
}
