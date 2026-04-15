import { createHmac } from "node:crypto";
import process from "node:process";
import { getProjectPaths } from "./paths.js";
import type {
  CapabilitySnapshot,
  ExecutionPlane,
  ExecutionResult,
  OkxCommandIntent,
  ProbeModuleName,
  ProbeReasonCode,
  ProbeReceipt,
} from "./types.js";

export interface OkxJsonResult<T> {
  ok: boolean;
  source: "okx-cli" | "unavailable";
  command: string;
  data?: T;
  reason?: string;
}

export interface OkxAccountSnapshot {
  source: "okx-cli" | "fallback";
  balance?: unknown;
  positions?: unknown;
  feeRates?: unknown;
  bills?: unknown;
  commands: string[];
  errors: string[];
}

export interface OkxMarketSnapshot {
  source: "okx-cli" | "fallback";
  tickers: Record<string, unknown>;
  candles: Record<string, unknown>;
  fundingRates: Record<string, unknown>;
  orderbooks: Record<string, unknown>;
  commands: string[];
  errors: string[];
}

// --- OKX REST API helpers ---

const OKX_BASE_URL = "https://www.okx.com";

interface OkxEndpoint {
  method: string;
  path: string;
  query: Record<string, string>;
  needsAuth: boolean;
}

function hasApiCredentials(): boolean {
  return Boolean(
    process.env.OKX_API_KEY &&
    process.env.OKX_SECRET_KEY &&
    process.env.OKX_PASSPHRASE,
  );
}

function argsToEndpoint(args: string[]): OkxEndpoint | null {
  const [domain, action, ...rest] = args;
  if (!domain || !action) return null;

  // Market endpoints (no auth needed)
  if (domain === "market") {
    if (action === "ticker" && rest[0]) {
      return { method: "GET", path: "/api/v5/market/ticker", query: { instId: rest[0] }, needsAuth: false };
    }
    if (action === "candles" && rest[0]) {
      const query: Record<string, string> = { instId: rest[0] };
      for (let i = 1; i < rest.length; i++) {
        if (rest[i] === "--bar" && rest[i + 1]) { query.bar = rest[++i]; continue; }
        if (rest[i] === "--limit" && rest[i + 1]) { query.limit = rest[++i]; continue; }
      }
      return { method: "GET", path: "/api/v5/market/candles", query, needsAuth: false };
    }
    if (action === "funding-rate" && rest[0]) {
      return { method: "GET", path: "/api/v5/market/funding-rate", query: { instId: rest[0] }, needsAuth: false };
    }
    if (action === "orderbook" && rest[0]) {
      const query: Record<string, string> = { instId: rest[0] };
      for (let i = 1; i < rest.length; i++) {
        if (rest[i] === "--sz" && rest[i + 1]) { query.sz = rest[++i]; continue; }
      }
      return { method: "GET", path: "/api/v5/market/books", query, needsAuth: false };
    }
  }

  // Account endpoints (auth required)
  if (domain === "account") {
    if (action === "balance") {
      return { method: "GET", path: "/api/v5/account/balance", query: {}, needsAuth: true };
    }
    if (action === "positions") {
      return { method: "GET", path: "/api/v5/account/positions", query: {}, needsAuth: true };
    }
    if (action === "fee-rates") {
      return { method: "GET", path: "/api/v5/account/trade-fee", query: { instType: "SWAP" }, needsAuth: true };
    }
    if (action === "bills") {
      return { method: "GET", path: "/api/v5/account/bills", query: {}, needsAuth: true };
    }
  }

  // Trade endpoints (auth required)
  if (domain === "trade") {
    if (action === "orders-history") {
      const query: Record<string, string> = {};
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--clOrdId" && rest[i + 1]) { query.clOrdId = rest[++i]; continue; }
        if (rest[i] === "--instId" && rest[i + 1]) { query.instId = rest[++i]; continue; }
      }
      return { method: "GET", path: "/api/v5/trade/orders-history", query, needsAuth: true };
    }
  }

  return null;
}

function signOkxRequest(
  timestamp: string,
  method: string,
  requestPath: string,
  secretKey: string,
): string {
  const message = `${timestamp}${method.toUpperCase()}${requestPath}`;
  return createHmac("sha256", secretKey).update(message).digest("base64");
}

function buildAuthHeaders(method: string, requestPath: string): Record<string, string> {
  const timestamp = new Date().toISOString();
  const sign = signOkxRequest(
    timestamp,
    method,
    requestPath,
    process.env.OKX_SECRET_KEY ?? "",
  );
  return {
    "OK-ACCESS-KEY": process.env.OKX_API_KEY ?? "",
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": process.env.OKX_PASSPHRASE ?? "",
  };
}

function buildHeaders(plane: ExecutionPlane, needsAuth: boolean, requestPath: string, method: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (plane === "demo") {
    headers["x-simulated-trading"] = "1";
  }
  if (needsAuth) {
    Object.assign(headers, buildAuthHeaders(method, requestPath));
  }
  return headers;
}

function endpointToUrl(endpoint: OkxEndpoint): string {
  const qs = new URLSearchParams(endpoint.query).toString();
  return `${OKX_BASE_URL}${endpoint.path}${qs ? `?${qs}` : ""}`;
}

function requestPathForSign(endpoint: OkxEndpoint): string {
  const qs = new URLSearchParams(endpoint.query).toString();
  return `${endpoint.path}${qs ? `?${qs}` : ""}`;
}

// --- Display helpers ---

function tokenize(command: string): string[] {
  return (
    command
      .match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g)
      ?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? []
  );
}

export function buildOkxCommand(args: string[], plane: ExecutionPlane): string {
  const parts = ["okx", ...args];
  if (plane === "demo") parts.push("--profile", "demo", "--json");
  else if (plane === "live") parts.push("--profile", "live", "--json");
  else parts.push("--json");
  return parts.join(" ");
}

// --- Error classification ---

function summarizeOkxErrorPayload(payload: Record<string, unknown>): string {
  const code = typeof payload.code === "string" || typeof payload.code === "number"
    ? String(payload.code)
    : "unknown";
  const msg = typeof payload.msg === "string" && payload.msg.trim().length > 0
    ? payload.msg.trim()
    : "OKX API response contained a non-zero code";
  return `OKX response code=${code}: ${msg}`;
}

function classifyProbeReason(message: string): ProbeReasonCode {
  const normalized = message.toLowerCase();
  if (normalized.includes("not installed on path") || normalized.includes("enoent") || normalized.includes("api key")) {
    return "cli_missing";
  }
  if (normalized.includes("timed out") || normalized.includes("etimedout") || normalized.includes("timeout")) {
    return "timeout";
  }
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("auth") ||
    normalized.includes("permission denied") ||
    normalized.includes("forbidden")
  ) {
    return "auth_failed";
  }
  if (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  ) {
    return "rate_limited";
  }
  if (normalized.includes("non-json") || normalized.includes("json")) {
    return "schema_mismatch";
  }
  if (
    normalized.includes("network") ||
    normalized.includes("econnreset") ||
    normalized.includes("connection reset") ||
    normalized.includes("gateway timeout") ||
    normalized.includes("status 502") ||
    normalized.includes("status 503")
  ) {
    return "network_error";
  }
  return "unknown";
}

function nextActionForProbeReason(reasonCode: ProbeReasonCode, plane: ExecutionPlane): string {
  return `node dist/bin/trademesh.js doctor --probe active --plane ${plane}`;
}

function detectOkxExecutionError(stdout: string, requiresWrite: boolean): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return requiresWrite ? "OKX API returned empty body for a write intent." : null;
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

  const response = parsed as Record<string, unknown>;
  if ("code" in response) {
    const responseCode = String(response.code ?? "");
    if (responseCode !== "" && responseCode !== "0") {
      return summarizeOkxErrorPayload(response);
    }
  }

  const data = response.data;
  if (!Array.isArray(data)) {
    return null;
  }

  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }

    const item = row as Record<string, unknown>;
    if ("sCode" in item) {
      const sCode = String(item.sCode ?? "");
      if (sCode && sCode !== "0") {
        const sMsg = typeof item.sMsg === "string" && item.sMsg.trim().length > 0
          ? item.sMsg.trim()
          : "order-level error";
        return `OKX order reject sCode=${sCode}: ${sMsg}`;
      }
    }
  }

  return null;
}

function decorateCapabilitySnapshot(input: {
  okxCliAvailable: boolean;
  demoProfileLikelyConfigured: boolean;
  liveProfileLikelyConfigured: boolean;
  configExists: boolean;
}): Pick<CapabilitySnapshot, "readinessGrade" | "blockers" | "recommendedPlane"> {
  const blockers: string[] = [];

  if (!input.okxCliAvailable) {
    blockers.push("OKX API credentials missing (OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE)");
  }
  if (!input.configExists) {
    blockers.push("OKX API credentials not configured");
  }
  if (!input.demoProfileLikelyConfigured) {
    blockers.push("API credentials not configured (needed for demo trading)");
  }

  if (input.okxCliAvailable && input.configExists && input.demoProfileLikelyConfigured) {
    return {
      readinessGrade: "A",
      blockers,
      recommendedPlane: "demo",
    };
  }

  if (input.okxCliAvailable && input.configExists) {
    return {
      readinessGrade: "B",
      blockers,
      recommendedPlane: input.liveProfileLikelyConfigured ? "live" : "research",
    };
  }

  if (input.okxCliAvailable || input.configExists) {
    return {
      readinessGrade: "C",
      blockers,
      recommendedPlane: input.demoProfileLikelyConfigured ? "demo" : "research",
    };
  }

  return {
    readinessGrade: "D",
    blockers,
    recommendedPlane: "research",
  };
}

export async function inspectOkxEnvironment(): Promise<CapabilitySnapshot> {
  const { profilesRoot } = getProjectPaths();
  const credentialsAvailable = hasApiCredentials();
  const configPath = credentialsAvailable
    ? "env:OKX_API_KEY,OKX_SECRET_KEY,OKX_PASSPHRASE"
    : profilesRoot;

  const warnings: string[] = [];

  if (!credentialsAvailable) {
    warnings.push("OKX API credentials not found. Set OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE environment variables.");
    warnings.push("Market endpoints are public and will work without credentials.");
    warnings.push("Account endpoints require valid API credentials.");
  }

  const decoration = decorateCapabilitySnapshot({
    okxCliAvailable: credentialsAvailable,
    configExists: credentialsAvailable,
    demoProfileLikelyConfigured: credentialsAvailable,
    liveProfileLikelyConfigured: credentialsAvailable,
  });

  return {
    okxCliAvailable: credentialsAvailable,
    okxCliPath: credentialsAvailable ? "env:OKX_API_KEY" : undefined,
    configPath,
    configExists: credentialsAvailable,
    demoProfileLikelyConfigured: credentialsAvailable,
    liveProfileLikelyConfigured: credentialsAvailable,
    readinessGrade: decoration.readinessGrade,
    blockers: decoration.blockers,
    recommendedPlane: decoration.recommendedPlane,
    warnings,
  };
}

export function createCommandIntent(
  command: string,
  options: {
    module: string;
    requiresWrite: boolean;
    reason: string;
    intentId?: string;
    stepIndex?: number;
    safeToRetry?: boolean;
    clientOrderRef?: string;
  },
): OkxCommandIntent {
  return {
    intentId: options.intentId ?? `${options.module}:${command}`,
    stepIndex: options.stepIndex ?? 0,
    safeToRetry: options.safeToRetry ?? !options.requiresWrite,
    clientOrderRef: options.clientOrderRef,
    command,
    args: tokenize(command),
    module: options.module,
    requiresWrite: options.requiresWrite,
    reason: options.reason,
  };
}

export async function executeIntent(intent: OkxCommandIntent, execute: boolean): Promise<ExecutionResult> {
  const startedAtIso = new Date().toISOString();
  if (!execute) {
    return {
      intent,
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      skipped: true,
      dryRun: true,
      startedAt: startedAtIso,
      finishedAt: startedAtIso,
      durationMs: 0,
    };
  }

  // Parse args: skip the leading "okx" binary name if present
  const rawArgs = intent.args.length > 0 ? intent.args : tokenize(intent.command);
  const args = rawArgs[0] === "okx" ? rawArgs.slice(1) : rawArgs;
  if (args.length === 0) {
    return {
      intent,
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "Unable to parse command intent.",
      skipped: false,
      dryRun: false,
      startedAt: startedAtIso,
      finishedAt: startedAtIso,
      durationMs: 0,
    };
  }

  const endpoint = argsToEndpoint(args);
  if (!endpoint) {
    return {
      intent,
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: `Unknown OKX command: ${args.join(" ")}`,
      skipped: false,
      dryRun: false,
      startedAt: startedAtIso,
      finishedAt: startedAtIso,
      durationMs: 0,
    };
  }

  if (endpoint.needsAuth && !hasApiCredentials()) {
    return {
      intent,
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "OKX API credentials not configured (OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE).",
      skipped: false,
      dryRun: false,
      startedAt: startedAtIso,
      finishedAt: startedAtIso,
      durationMs: 0,
    };
  }

  const url = endpointToUrl(endpoint);
  const signPath = requestPathForSign(endpoint);
  const headers = buildHeaders("demo", endpoint.needsAuth, signPath, endpoint.method);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: endpoint.method,
      headers,
      signal: AbortSignal.timeout(intent.requiresWrite ? 25_000 : 15_000),
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    return {
      intent,
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: message,
      skipped: false,
      dryRun: false,
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      durationMs,
    };
  }

  const durationMs = Date.now() - startedAt;
  const stdout = await response.text().catch(() => "");
  const stderrParts: string[] = [];

  if (!response.ok) {
    stderrParts.push(`OKX API returned HTTP ${response.status}: ${response.statusText}`);
  }

  const semanticError = response.ok ? detectOkxExecutionError(stdout, intent.requiresWrite) : null;
  if (semanticError) {
    stderrParts.push(semanticError);
  }

  const stderr = stderrParts.filter((entry) => entry.trim().length > 0).join("\n");

  return {
    intent,
    ok: response.ok && !semanticError,
    exitCode: response.ok ? 0 : response.status,
    stdout,
    stderr,
    skipped: false,
    dryRun: false,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    durationMs,
  };
}

export async function runOkxJson<T>(args: string[], plane: ExecutionPlane): Promise<OkxJsonResult<T>> {
  const command = buildOkxCommand(args, plane);
  const endpoint = argsToEndpoint(args);

  if (!endpoint) {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: `Unknown OKX command: ${args.join(" ")}`,
    };
  }

  // Account/trade endpoints require credentials
  if (endpoint.needsAuth && !hasApiCredentials()) {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: "OKX API credentials not configured (OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE).",
    };
  }

  const url = endpointToUrl(endpoint);
  const signPath = requestPathForSign(endpoint);
  const headers = buildHeaders(plane, endpoint.needsAuth, signPath, endpoint.method);

  let response: Response;
  try {
    response = await fetch(url, {
      method: endpoint.method,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: `OKX API returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  const body = await response.text();
  if (!body.trim()) {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: "OKX API returned an empty response.",
    };
  }

  try {
    const parsed = JSON.parse(body);
    // Check for OKX API-level errors (code !== "0")
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const payload = parsed as Record<string, unknown>;
      if ("code" in payload) {
        const responseCode = String(payload.code ?? "");
        if (responseCode !== "" && responseCode !== "0") {
          return {
            ok: false,
            source: "unavailable",
            command,
            reason: summarizeOkxErrorPayload(payload),
          };
        }
      }
    }
    return {
      ok: true,
      source: "okx-cli",
      command,
      data: parsed as T,
    };
  } catch {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: "OKX API returned non-JSON output.",
    };
  }
}

export async function readAccountSnapshot(plane: ExecutionPlane): Promise<OkxAccountSnapshot> {
  const [balance, positions, feeRates, bills] = await Promise.all([
    runOkxJson<unknown>(["account", "balance"], plane),
    runOkxJson<unknown>(["account", "positions"], plane),
    runOkxJson<unknown>(["account", "fee-rates"], plane),
    runOkxJson<unknown>(["account", "bills"], plane),
  ]);

  const commands = [balance.command, positions.command, feeRates.command, bills.command];
  const errors = [balance, positions, feeRates, bills]
    .filter((result) => !result.ok)
    .map((result) => result.reason ?? "Unknown OKX API error");
  const hasAnyData = balance.ok || positions.ok || feeRates.ok || bills.ok;

  return {
    source: hasAnyData ? "okx-cli" : "fallback",
    balance: balance.data,
    positions: positions.data,
    feeRates: feeRates.data,
    bills: bills.data,
    commands,
    errors,
  };
}

export async function readMarketSnapshot(instIds: string[], plane: ExecutionPlane): Promise<OkxMarketSnapshot> {
  const tickers: Record<string, unknown> = {};
  const candles: Record<string, unknown> = {};
  const fundingRates: Record<string, unknown> = {};
  const orderbooks: Record<string, unknown> = {};
  const commands: string[] = [];
  const errors: string[] = [];

  // Fetch all market data in parallel for each instrument
  const fetches = instIds.flatMap((instId) => {
    const symbol = instId.split("-")[0] ?? instId;
    const fundingInstId = `${symbol}-USDT-SWAP`;
    return [
      { key: "ticker" as const, instId, promise: runOkxJson<unknown>(["market", "ticker", instId], plane) },
      { key: "candle" as const, instId, promise: runOkxJson<unknown>(["market", "candles", instId, "--bar", "1H", "--limit", "120"], plane) },
      { key: "funding" as const, instId: fundingInstId, promise: runOkxJson<unknown>(["market", "funding-rate", fundingInstId], plane) },
      { key: "orderbook" as const, instId, promise: runOkxJson<unknown>(["market", "orderbook", instId, "--sz", "20"], plane) },
    ];
  });

  const results = await Promise.all(fetches.map((f) => f.promise.then((r) => ({ ...f, result: r }))));

  for (const entry of results) {
    const { key, instId, result } = entry;
    commands.push(result.command);

    if (result.ok) {
      if (key === "ticker") tickers[instId] = result.data;
      else if (key === "candle") candles[instId] = result.data;
      else if (key === "funding") fundingRates[instId] = result.data;
      else if (key === "orderbook") orderbooks[instId] = result.data;
    } else {
      errors.push(`${instId} ${key}: ${result.reason ?? "Unknown OKX API error"}`);
    }
  }

  const hasAnyData =
    Object.keys(tickers).length > 0 ||
    Object.keys(candles).length > 0 ||
    Object.keys(fundingRates).length > 0 ||
    Object.keys(orderbooks).length > 0;

  return {
    source: hasAnyData ? "okx-cli" : "fallback",
    tickers,
    candles,
    fundingRates,
    orderbooks,
    commands,
    errors,
  };
}

export async function runOkxProbe(
  module: ProbeModuleName,
  args: string[],
  plane: ExecutionPlane,
  timeoutMs = 8_000,
): Promise<ProbeReceipt> {
  const command = buildOkxCommand(args, plane);
  const startedAt = Date.now();
  const endpoint = argsToEndpoint(args);

  if (!endpoint) {
    const reasonCode: ProbeReasonCode = "cli_missing";
    return {
      module,
      command,
      ok: false,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: `Unknown OKX command: ${args.join(" ")}`,
      reasonCode,
      nextActionCmd: nextActionForProbeReason(reasonCode, plane),
      message: `Unknown OKX command: ${args.join(" ")}`,
    };
  }

  // Account/trade endpoints require credentials; market endpoints are public
  if (endpoint.needsAuth && !hasApiCredentials()) {
    const reasonCode: ProbeReasonCode = "cli_missing";
    return {
      module,
      command,
      ok: false,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: "OKX API credentials not configured.",
      reasonCode,
      nextActionCmd: nextActionForProbeReason(reasonCode, plane),
      message: "OKX API credentials not configured (OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE).",
    };
  }

  const url = endpointToUrl(endpoint);
  const signPath = requestPathForSign(endpoint);
  const headers = buildHeaders(plane, endpoint.needsAuth, signPath, endpoint.method);

  let response: Response;
  let fetchError: string | undefined;
  try {
    response = await fetch(url, {
      method: endpoint.method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
    const reasonCode = classifyProbeReason(fetchError);
    return {
      module,
      command,
      ok: false,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: fetchError,
      reasonCode,
      nextActionCmd: nextActionForProbeReason(reasonCode, plane),
      message: fetchError,
    };
  }

  const durationMs = Date.now() - startedAt;
  const stdout = await response.text().catch(() => "");
  const stderr = "";

  if (!response.ok) {
    const message = `OKX API returned HTTP ${response.status}: ${response.statusText}`;
    const reasonCode = classifyProbeReason(message);
    return {
      module,
      command,
      ok: false,
      exitCode: response.status,
      durationMs,
      stdout,
      stderr,
      reasonCode,
      nextActionCmd: nextActionForProbeReason(reasonCode, plane),
      message,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const reasonCode: ProbeReasonCode = "schema_mismatch";
    return {
      module,
      command,
      ok: false,
      exitCode: response.status,
      durationMs,
      stdout,
      stderr,
      reasonCode,
      nextActionCmd: nextActionForProbeReason(reasonCode, plane),
      message: "OKX API returned non-JSON output.",
    };
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const payload = parsed as Record<string, unknown>;
    if ("code" in payload) {
      const responseCode = String(payload.code ?? "");
      if (responseCode !== "" && responseCode !== "0") {
        const message = summarizeOkxErrorPayload(payload);
        const reasonCode = classifyProbeReason(message);
        return {
          module,
          command,
          ok: false,
          exitCode: response.status,
          durationMs,
          stdout,
          stderr,
          reasonCode,
          nextActionCmd: nextActionForProbeReason(reasonCode, plane),
          message,
        };
      }
    }
  }

  return {
    module,
    command,
    ok: true,
    exitCode: response.status,
    durationMs,
    stdout,
    stderr,
  };
}
