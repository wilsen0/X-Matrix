import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function lookupOkxPath(): string | undefined {
  const okxLookup = spawnSync("bash", ["-lc", "command -v okx"], { encoding: "utf8" });
  if (okxLookup.status !== 0) {
    return undefined;
  }

  const path = okxLookup.stdout.trim();
  return path.length > 0 ? path : undefined;
}

function tokenize(command: string): string[] {
  return (
    command
      .match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g)
      ?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? []
  );
}

function summarizeOkxErrorPayload(payload: Record<string, unknown>): string {
  const code = typeof payload.code === "string" || typeof payload.code === "number"
    ? String(payload.code)
    : "unknown";
  const msg = typeof payload.msg === "string" && payload.msg.trim().length > 0
    ? payload.msg.trim()
    : "okx CLI response contained a non-zero code";
  return `OKX response code=${code}: ${msg}`;
}

function classifyProbeReason(message: string): ProbeReasonCode {
  const normalized = message.toLowerCase();
  if (normalized.includes("not installed on path") || normalized.includes("enoent")) {
    return "cli_missing";
  }
  if (normalized.includes("timed out") || normalized.includes("etimedout") || normalized.includes("timeout")) {
    return "timeout";
  }
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("auth") ||
    normalized.includes("api key") ||
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
  if (reasonCode === "cli_missing") {
    return `node dist/bin/trademesh.js doctor --probe active --plane ${plane}`;
  }
  if (reasonCode === "auth_failed") {
    return `node dist/bin/trademesh.js doctor --probe active --plane ${plane}`;
  }
  if (reasonCode === "network_error" || reasonCode === "timeout") {
    return `node dist/bin/trademesh.js doctor --probe active --plane ${plane}`;
  }
  if (reasonCode === "schema_mismatch") {
    return `node dist/bin/trademesh.js doctor --probe active --plane ${plane}`;
  }
  if (reasonCode === "rate_limited") {
    return `node dist/bin/trademesh.js doctor --probe active --plane ${plane}`;
  }
  return `node dist/bin/trademesh.js doctor --probe active --plane ${plane}`;
}

function detectOkxExecutionError(stdout: string, requiresWrite: boolean): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return requiresWrite ? "OKX CLI returned empty stdout for a write intent." : null;
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

function detectProfilesInConfig(raw: string): { demo: boolean; live: boolean } {
  const lowered = raw.toLowerCase();
  return {
    demo: /demo/.test(lowered),
    live: /live/.test(lowered) || /apikey/.test(lowered) || /secretkey/.test(lowered),
  };
}

function decorateCapabilitySnapshot(input: {
  okxCliAvailable: boolean;
  demoProfileLikelyConfigured: boolean;
  liveProfileLikelyConfigured: boolean;
  configExists: boolean;
}): Pick<CapabilitySnapshot, "readinessGrade" | "blockers" | "recommendedPlane"> {
  const blockers: string[] = [];

  if (!input.okxCliAvailable) {
    blockers.push("okx CLI missing on PATH");
  }
  if (!input.configExists) {
    blockers.push("OKX config/profiles missing");
  }
  if (!input.demoProfileLikelyConfigured) {
    blockers.push("demo profile not configured");
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
  const okxCliPath = lookupOkxPath();
  const homeConfigPath = join(homedir(), ".okx", "config.toml");
  const homeConfigExists = await pathExists(homeConfigPath);

  let configPath = homeConfigPath;
  let configExists = homeConfigExists;
  let demoProfileLikelyConfigured = false;
  let liveProfileLikelyConfigured = false;
  const warnings: string[] = [];

  if (!okxCliPath) {
    warnings.push("okx CLI was not found on PATH.");
  }

  if (homeConfigExists) {
    try {
      const raw = await readFile(homeConfigPath, "utf8");
      const detected = detectProfilesInConfig(raw);
      demoProfileLikelyConfigured = detected.demo;
      liveProfileLikelyConfigured = detected.live;

      if (!demoProfileLikelyConfigured) {
        warnings.push("demo profile markers were not detected in ~/.okx/config.toml.");
      }
      if (!liveProfileLikelyConfigured) {
        warnings.push("live profile markers were not detected in ~/.okx/config.toml.");
      }
    } catch {
      warnings.push("~/.okx/config.toml exists but could not be read.");
    }
  } else {
    configPath = profilesRoot;
    configExists = await pathExists(profilesRoot);
    demoProfileLikelyConfigured = await pathExists(join(profilesRoot, "demo.toml"));
    liveProfileLikelyConfigured = await pathExists(join(profilesRoot, "live.toml"));

    warnings.push("~/.okx/config.toml was not found; falling back to project profiles/ (local development mode).");

    if (!configExists) {
      warnings.push("profiles directory was not found.");
    }
    if (!demoProfileLikelyConfigured) {
      warnings.push("demo profile was not found (profiles/demo.toml).");
    }
    if (!liveProfileLikelyConfigured) {
      warnings.push("live profile was not found (profiles/live.toml).");
    }
  }

  const decoration = decorateCapabilitySnapshot({
    okxCliAvailable: Boolean(okxCliPath),
    configExists,
    demoProfileLikelyConfigured,
    liveProfileLikelyConfigured,
  });

  return {
    okxCliAvailable: Boolean(okxCliPath),
    okxCliPath,
    configPath,
    configExists,
    demoProfileLikelyConfigured,
    liveProfileLikelyConfigured,
    readinessGrade: decoration.readinessGrade,
    blockers: decoration.blockers,
    recommendedPlane: decoration.recommendedPlane,
    warnings,
  };
}

function buildPlaneFlags(plane: ExecutionPlane): string[] {
  if (plane === "demo") {
    return ["--profile", "demo", "--json"];
  }

  if (plane === "live") {
    return ["--profile", "live", "--json"];
  }

  return ["--json"];
}

export function buildOkxCommand(args: string[], plane: ExecutionPlane): string {
  return ["okx", ...args, ...buildPlaneFlags(plane)].join(" ");
}

export function runOkxJson<T>(args: string[], plane: ExecutionPlane): OkxJsonResult<T> {
  const command = buildOkxCommand(args, plane);
  if (!lookupOkxPath()) {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: "okx CLI is not installed on PATH.",
    };
  }

  const result = spawnSync("okx", [...args, ...buildPlaneFlags(plane)], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: result.stderr.trim() || "okx CLI returned a non-zero exit status.",
    };
  }

  if (!result.stdout.trim()) {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: "okx CLI returned an empty response.",
    };
  }

  try {
    return {
      ok: true,
      source: "okx-cli",
      command,
      data: JSON.parse(result.stdout) as T,
    };
  } catch {
    return {
      ok: false,
      source: "unavailable",
      command,
      reason: "okx CLI returned non-JSON output.",
    };
  }
}

export function readAccountSnapshot(plane: ExecutionPlane): OkxAccountSnapshot {
  const balance = runOkxJson<unknown>(["account", "balance"], plane);
  const positions = runOkxJson<unknown>(["account", "positions"], plane);
  const feeRates = runOkxJson<unknown>(["account", "fee-rates"], plane);
  const bills = runOkxJson<unknown>(["account", "bills"], plane);

  const commands = [balance.command, positions.command, feeRates.command, bills.command];
  const errors = [balance, positions, feeRates, bills]
    .filter((result) => !result.ok)
    .map((result) => result.reason ?? "Unknown OKX CLI error");
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

export function readMarketSnapshot(instIds: string[], plane: ExecutionPlane): OkxMarketSnapshot {
  const tickers: Record<string, unknown> = {};
  const candles: Record<string, unknown> = {};
  const fundingRates: Record<string, unknown> = {};
  const orderbooks: Record<string, unknown> = {};
  const commands: string[] = [];
  const errors: string[] = [];

  for (const instId of instIds) {
    const symbol = instId.split("-")[0] ?? instId;
    const fundingInstId = `${symbol}-USDT-SWAP`;
    const ticker = runOkxJson<unknown>(["market", "ticker", instId], plane);
    const candle = runOkxJson<unknown>(["market", "candles", instId, "--bar", "1H", "--limit", "120"], plane);
    const fundingRate = runOkxJson<unknown>(["market", "funding-rate", fundingInstId], plane);
    const orderbook = runOkxJson<unknown>(["market", "orderbook", instId, "--sz", "20"], plane);
    commands.push(ticker.command, candle.command, fundingRate.command, orderbook.command);

    if (ticker.ok) {
      tickers[instId] = ticker.data;
    } else {
      errors.push(`${instId} ticker: ${ticker.reason ?? "Unknown OKX CLI error"}`);
    }

    if (candle.ok) {
      candles[instId] = candle.data;
    } else {
      errors.push(`${instId} candles: ${candle.reason ?? "Unknown OKX CLI error"}`);
    }

    if (fundingRate.ok) {
      fundingRates[fundingInstId] = fundingRate.data;
    } else {
      errors.push(`${fundingInstId} funding-rate: ${fundingRate.reason ?? "Unknown OKX CLI error"}`);
    }

    if (orderbook.ok) {
      orderbooks[instId] = orderbook.data;
    } else {
      errors.push(`${instId} orderbook: ${orderbook.reason ?? "Unknown OKX CLI error"}`);
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

export function executeIntent(intent: OkxCommandIntent, execute: boolean): ExecutionResult {
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

  const [bin, ...args] = intent.args.length > 0 ? intent.args : tokenize(intent.command);
  if (!bin) {
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

  const startedAt = Date.now();
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: intent.requiresWrite ? 25_000 : 15_000,
  });
  const durationMs = Date.now() - startedAt;
  const semanticError = result.status === 0
    ? detectOkxExecutionError(result.stdout ?? "", intent.requiresWrite)
    : null;
  const stderrParts = [result.stderr ?? ""];
  if (result.error instanceof Error) {
    stderrParts.push(result.error.message);
  }
  if (semanticError) {
    stderrParts.push(semanticError);
  }
  const stderr = stderrParts.filter((entry) => entry.trim().length > 0).join("\n");

  return {
    intent,
    ok: result.status === 0 && !semanticError && !result.error,
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr,
    skipped: false,
    dryRun: false,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    durationMs,
  };
}

export function runOkxProbe(
  module: ProbeModuleName,
  args: string[],
  plane: ExecutionPlane,
  timeoutMs = 8_000,
): ProbeReceipt {
  const command = buildOkxCommand(args, plane);
  const startedAt = Date.now();

  if (!lookupOkxPath()) {
    const reasonCode: ProbeReasonCode = "cli_missing";
    return {
      module,
      command,
      ok: false,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: "okx CLI is not installed on PATH.",
      reasonCode,
      nextActionCmd: nextActionForProbeReason(reasonCode, plane),
      message: "okx CLI is not installed on PATH.",
    };
  }

  const result = spawnSync("okx", [...args, ...buildPlaneFlags(plane)], {
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const durationMs = Date.now() - startedAt;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (result.error) {
    const message = stderr || result.error.message;
    const reasonCode = classifyProbeReason(message);
    return {
      module,
      command,
      ok: false,
      exitCode: result.status,
      durationMs,
      stdout,
      stderr: message,
      reasonCode,
      nextActionCmd: nextActionForProbeReason(reasonCode, plane),
      message: result.error.message,
    };
  }

  if (result.status !== 0) {
    const message = stderr.trim() || "okx CLI returned a non-zero exit status.";
    const reasonCode = classifyProbeReason(message);
    return {
      module,
      command,
      ok: false,
      exitCode: result.status,
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
      exitCode: result.status,
      durationMs,
      stdout,
      stderr,
      reasonCode,
      nextActionCmd: nextActionForProbeReason(reasonCode, plane),
      message: "okx CLI returned non-JSON output.",
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
          exitCode: result.status,
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
    exitCode: result.status,
    durationMs,
    stdout,
    stderr,
  };
}
