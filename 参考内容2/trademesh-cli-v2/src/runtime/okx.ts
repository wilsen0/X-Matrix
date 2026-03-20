import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CapabilitySnapshot, ExecutionResult, OkxCommandIntent, Plane } from "./types.js";

function tokenize(command: string): string[] {
  return command.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g)?.map((part) => part.replace(/^['"]|['"]$/g, "")) ?? [];
}

function makeIntent(module: string, requiresWrite: boolean, reason: string, command: string): OkxCommandIntent {
  return {
    module,
    requiresWrite,
    reason,
    command,
    args: tokenize(command),
  };
}

function baseFlags(plane: Plane): string {
  if (plane === "demo") return "--profile demo --json";
  if (plane === "live") return "--profile live --json";
  return "--json";
}

export function buildOkxCommandIntents(goal: string, plane: Plane): Record<string, OkxCommandIntent[]> {
  const flags = baseFlags(plane);
  const research = [
    makeIntent("account", false, "Read balances before risk analysis.", `okx account balance ${flags}`),
    makeIntent("account", false, "Read open positions before proposing a hedge.", `okx account positions ${flags}`),
    makeIntent("market", false, "Read spot ticker context.", `okx market ticker BTC-USDT ${flags}`),
    makeIntent("market", false, "Read hourly candles for recent volatility context.", `okx market candles BTC-USDT --bar 1H --limit 120 ${flags}`),
  ];

  if (/(hedge|drawdown|protect|downside)/i.test(goal)) {
    return {
      "light-perp-hedge": [
        ...research,
        makeIntent(
          "swap",
          true,
          "Sell a small perpetual hedge leg in demo or live after policy approval.",
          `okx swap place-order --instId BTC-USDT-SWAP --tdMode cross --side sell --ordType market --sz 0.01 ${flags}`,
        ),
      ],
      "protective-put": [
        ...research,
        makeIntent(
          "option",
          true,
          "Buy downside protection with a put option.",
          `okx option place-order --instId BTC-USD-260327-90000-P --tdMode cross --side buy --ordType market --sz 1 ${flags}`,
        ),
      ],
      collar: [
        ...research,
        makeIntent(
          "option",
          true,
          "Buy a put leg for protection.",
          `okx option place-order --instId BTC-USD-260327-90000-P --tdMode cross --side buy --ordType market --sz 1 ${flags}`,
        ),
        makeIntent(
          "option",
          true,
          "Finance part of the premium by selling an upside call.",
          `okx option place-order --instId BTC-USD-260327-120000-C --tdMode cross --side sell --ordType market --sz 1 ${flags}`,
        ),
      ],
    };
  }

  return {
    observation: research,
  };
}

function detectProfilesInConfig(raw: string): { demo: boolean; live: boolean } {
  const lowered = raw.toLowerCase();
  return {
    demo: /demo/.test(lowered),
    live: /live/.test(lowered) || /apikey/.test(lowered) || /secretkey/.test(lowered),
  };
}

export function inspectOkxEnvironment(): CapabilitySnapshot {
  const configPath = path.join(os.homedir(), ".okx", "config.toml");
  const which = spawnSync("bash", ["-lc", "command -v okx || true"], { encoding: "utf8" });
  const okxCliPath = which.stdout.trim() || undefined;
  const configExists = fs.existsSync(configPath);
  const warnings: string[] = [];
  let demoProfileLikelyConfigured = false;
  let liveProfileLikelyConfigured = false;

  if (!okxCliPath) warnings.push("okx CLI was not found on PATH.");
  if (!configExists) {
    warnings.push("~/.okx/config.toml was not found.");
  } else {
    const raw = fs.readFileSync(configPath, "utf8");
    const profiles = detectProfilesInConfig(raw);
    demoProfileLikelyConfigured = profiles.demo;
    liveProfileLikelyConfigured = profiles.live;
    if (!demoProfileLikelyConfigured) warnings.push("demo profile was not detected in ~/.okx/config.toml.");
    if (!liveProfileLikelyConfigured) warnings.push("live profile markers were not detected in ~/.okx/config.toml.");
  }

  return {
    okxCliAvailable: Boolean(okxCliPath),
    okxCliPath,
    configPath,
    configExists,
    demoProfileLikelyConfigured,
    liveProfileLikelyConfigured,
    warnings,
  };
}

export function executeIntent(intent: OkxCommandIntent, execute: boolean): ExecutionResult {
  if (!execute) {
    return {
      intent,
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      skipped: true,
      dryRun: true,
    };
  }

  const [bin, ...args] = intent.args;
  const result = spawnSync(bin, args, { encoding: "utf8" });
  return {
    intent,
    ok: result.status === 0,
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    skipped: false,
    dryRun: false,
  };
}
