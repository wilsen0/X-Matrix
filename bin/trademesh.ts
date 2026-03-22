#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  applyRun,
  certifySkills,
  describeSkillGraph,
  createPlan,
  exportRun,
  formatReplay,
  formatRunSummary,
  inspectSkill,
  listRuns,
  printSkillList,
  reconcileRun,
  replayRun,
  rehearseDemo,
  runDemo,
  runSkillStandalone,
  retryRun,
} from "../runtime/executor.js";
import { runDoctor } from "../runtime/doctor.js";
import type {
  ArtifactSnapshot,
  ExecutionPlane,
  GoalExecutePreference,
  GoalHedgeIntent,
  GoalIntakeOverrides,
  ProbeMode,
  DoctorStrictTarget,
  GoalTimeHorizon,
} from "../runtime/types.js";

type FlagMap = Record<string, string | boolean>;

interface ParsedArgs {
  flags: FlagMap;
  positionals: string[];
}

function parseArgs(args: string[]): ParsedArgs {
  const flags: FlagMap = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
      continue;
    }

    flags[key] = true;
  }

  return { flags, positionals };
}

function printHelp(): void {
  console.log(`Usage:
  trademesh doctor [--probe passive|active|write] [--plane research|demo|live] [--strict] [--strict-target plan|apply|execute]
  trademesh demo "<goal>" [--plane research|demo|live] [--execute] [--symbol BTC,ETH] [--max-drawdown 4] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--json]
  trademesh skills ls|list
  trademesh skills inspect <name> [--json]
  trademesh skills certify [--strict] [--json]
  trademesh skills run <name> "<goal>" [--plane research|demo|live] [--symbol BTC,ETH] [--max-drawdown 4] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--input <artifact.json>] [--skip-satisfied] [--json]
  trademesh skills graph [--json]
  trademesh runs list
  trademesh plan "<goal>" [--plane research|demo|live] [--profile demo|live] [--symbol BTC,ETH] [--max-drawdown 4] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--json]
  trademesh rehearse demo [--execute] [--approve] [--json]
  trademesh replay <run-id> [--skill <name>] [--json]
  trademesh retry <run-id> [--json]
  trademesh reconcile <run-id> [--source auto|client-id|fallback] [--window-min <n>] [--until-settled] [--max-attempts <n>] [--interval-sec <n>] [--json]
  trademesh export <run-id> [--format md|json] [--output <path>] [--json]
  trademesh apply <run-id> [--plane demo|live] [--profile demo|live] [--proposal <name>] [--approve] [--approved-by <name>] [--approval-reason <text>] [--live-confirm YES_LIVE_EXECUTION] [--max-order-usd <n>] [--max-total-usd <n>] [--execute] [--json]`);
}

function inferPlaneFromGoal(goal: string): ExecutionPlane {
  if (/\b(live|实盘)\b/i.test(goal)) {
    return "live";
  }

  if (/\b(demo|模拟|演练)\b/i.test(goal)) {
    return "demo";
  }

  return "research";
}

function resolvePlanPlane(
  goal: string,
  planeValue: string | boolean | undefined,
  legacyProfile: string | boolean | undefined,
): ExecutionPlane {
  if (planeValue === "research" || planeValue === "demo" || planeValue === "live") {
    return planeValue;
  }

  if (legacyProfile === "demo" || legacyProfile === "live") {
    return legacyProfile;
  }

  return inferPlaneFromGoal(goal);
}

function readExplicitApplyPlane(
  planeValue: string | boolean | undefined,
  legacyProfile: string | boolean | undefined,
): ExecutionPlane | undefined {
  if (planeValue === "demo" || planeValue === "live") {
    return planeValue;
  }

  if (legacyProfile === "demo" || legacyProfile === "live") {
    return legacyProfile;
  }

  return undefined;
}

function readDoctorPlane(planeValue: string | boolean | undefined): ExecutionPlane {
  if (planeValue === "research" || planeValue === "demo" || planeValue === "live") {
    return planeValue;
  }
  return "demo";
}

function parseSymbolList(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const symbols = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  return symbols.length > 0 ? [...new Set(symbols)] : undefined;
}

function parseDrawdownOverride(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/%/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseIntentOverride(
  value: string | boolean | undefined,
): Exclude<GoalHedgeIntent, "unspecified"> | undefined {
  if (value === "protect-downside") {
    return "protect_downside";
  }
  if (value === "reduce-beta") {
    return "reduce_beta";
  }
  if (value === "de-risk") {
    return "de_risk";
  }
  return undefined;
}

function parseHorizonOverride(
  value: string | boolean | undefined,
): Exclude<GoalTimeHorizon, "unspecified"> | undefined {
  if (value === "intraday" || value === "swing" || value === "position") {
    return value;
  }
  return undefined;
}

function goalOverridesFromFlags(
  flags: FlagMap,
  executePreference: GoalExecutePreference,
): GoalIntakeOverrides | undefined {
  const overrides: GoalIntakeOverrides = {
    executePreference,
  };

  const symbols = parseSymbolList(flags.symbol);
  if (symbols) {
    overrides.symbols = symbols;
  }

  const targetDrawdownPct = parseDrawdownOverride(flags["max-drawdown"]);
  if (targetDrawdownPct !== undefined) {
    overrides.targetDrawdownPct = targetDrawdownPct;
  }

  const hedgeIntent = parseIntentOverride(flags.intent);
  if (hedgeIntent) {
    overrides.hedgeIntent = hedgeIntent;
  }

  const timeHorizon = parseHorizonOverride(flags.horizon);
  if (timeHorizon) {
    overrides.timeHorizon = timeHorizon;
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function readProbeMode(value: string | boolean | undefined): ProbeMode {
  if (value === "active" || value === "write" || value === "passive") {
    return value;
  }
  return "passive";
}

function readStrictTarget(value: string | boolean | undefined): DoctorStrictTarget {
  if (value === "plan" || value === "apply" || value === "execute") {
    return value;
  }
  return "apply";
}

function parsePositiveNumber(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePositiveInteger(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function parseReconcileSource(value: string | boolean | undefined): "auto" | "client-id" | "fallback" | undefined {
  if (value === "auto" || value === "client-id" || value === "fallback") {
    return value;
  }
  return undefined;
}

async function readInputArtifacts(pathValue: string | boolean | undefined): Promise<ArtifactSnapshot | undefined> {
  if (typeof pathValue !== "string" || pathValue.trim().length === 0) {
    return undefined;
  }

  const raw = await readFile(pathValue, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "artifacts" in parsed) {
    const envelope = parsed as { artifacts?: unknown };
    if (envelope.artifacts && typeof envelope.artifacts === "object" && !Array.isArray(envelope.artifacts)) {
      return envelope.artifacts as ArtifactSnapshot;
    }
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as ArtifactSnapshot;
  }

  throw new Error("Standalone --input must be a JSON object or an artifact envelope with an 'artifacts' field.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const jsonMode = args.includes("--json");

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "doctor") {
    const parsed = parseArgs(args.slice(1));
    const report = await runDoctor({
      probeMode: readProbeMode(parsed.flags.probe),
      plane: readDoctorPlane(parsed.flags.plane),
      strict: parsed.flags.strict === true,
      strictTarget: readStrictTarget(parsed.flags["strict-target"]),
    });
    console.log(jsonMode ? JSON.stringify(report, null, 2) : report.summary);
    if (parsed.flags.strict === true && !report.strictPass) {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "demo") {
    const parsed = parseArgs(args.slice(1));
    const goal = parsed.positionals.join(" ").trim();

    if (!goal) {
      throw new Error("Missing goal. Example: trademesh demo \"hedge my BTC drawdown with demo first\"");
    }

    const session = await runDemo(goal, {
      plane: resolvePlanPlane(goal, parsed.flags.plane, parsed.flags.profile),
      execute: parsed.flags.execute === true,
      goalOverrides: goalOverridesFromFlags(
        parsed.flags,
        parsed.flags.execute === true ? "execute" : "dry_run",
      ),
    });

    console.log(jsonMode ? JSON.stringify(session, null, 2) : session.summary);
    return;
  }

  if (command === "skills" && (args[1] === "ls" || args[1] === "list")) {
    const listing = await printSkillList();
    console.log(jsonMode ? JSON.stringify(listing, null, 2) : listing.summary);
    return;
  }

  if (command === "skills" && args[1] === "inspect") {
    const parsed = parseArgs(args.slice(2));
    const skillName = parsed.positionals[0];
    if (!skillName) {
      throw new Error("Missing skill name. Example: trademesh skills inspect hedge-planner");
    }

    const inspection = await inspectSkill(skillName);
    console.log(jsonMode ? JSON.stringify(inspection, null, 2) : inspection.summary);
    return;
  }

  if (command === "skills" && args[1] === "certify") {
    const parsed = parseArgs(args.slice(2));
    const certification = await certifySkills();
    console.log(jsonMode ? JSON.stringify(certification, null, 2) : certification.summary);
    if (parsed.flags.strict === true && certification.report.failedSkills > 0) {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "skills" && args[1] === "run") {
    const parsed = parseArgs(args.slice(2));
    const skillName = parsed.positionals[0];
    const goal = parsed.positionals.slice(1).join(" ").trim();
    if (!skillName) {
      throw new Error("Missing skill name. Example: trademesh skills run hedge-planner \"hedge btc drawdown\"");
    }
    if (!goal) {
      throw new Error("Missing goal. Example: trademesh skills run hedge-planner \"hedge btc drawdown\"");
    }

    const record = await runSkillStandalone(skillName, goal, {
      plane: resolvePlanPlane(goal, parsed.flags.plane, parsed.flags.profile),
      goalOverrides: goalOverridesFromFlags(parsed.flags, parsed.flags.execute === true ? "execute" : "dry_run"),
      inputArtifacts: await readInputArtifacts(parsed.flags.input),
      skipSatisfied: parsed.flags["skip-satisfied"] === true,
    });
    console.log(jsonMode ? JSON.stringify(record, null, 2) : formatRunSummary(record));
    return;
  }

  if (command === "skills" && args[1] === "graph") {
    const graph = await describeSkillGraph();
    console.log(jsonMode ? JSON.stringify(graph, null, 2) : graph.summary);
    return;
  }

  if (command === "runs" && args[1] === "list") {
    const runs = await listRuns();
    console.log(jsonMode ? JSON.stringify(runs, null, 2) : runs.summary);
    return;
  }

  if (command === "plan") {
    const parsed = parseArgs(args.slice(1));
    const goal = parsed.positionals.join(" ").trim();

    if (!goal) {
      throw new Error("Missing goal. Example: trademesh plan \"reduce drawdown in demo mode\"");
    }

    const record = await createPlan(goal, {
      plane: resolvePlanPlane(goal, parsed.flags.plane, parsed.flags.profile),
      goalOverrides: goalOverridesFromFlags(parsed.flags, "plan_only"),
    });

    console.log(jsonMode ? JSON.stringify(record, null, 2) : formatRunSummary(record));
    return;
  }

  if (command === "rehearse" && args[1] === "demo") {
    const parsed = parseArgs(args.slice(2));
    const record = await rehearseDemo({
      execute: parsed.flags.execute === true,
      approve: parsed.flags.approve === true,
    });
    console.log(jsonMode ? JSON.stringify(record, null, 2) : formatRunSummary(record));
    return;
  }

  if (command === "replay") {
    const parsed = parseArgs(args.slice(1));
    const runId = parsed.positionals[0];

    if (!runId) {
      throw new Error("Missing run id. Example: trademesh replay run_20260319_001");
    }

    const record = await replayRun(runId, {
      skill: typeof parsed.flags.skill === "string" ? parsed.flags.skill : undefined,
    });
    console.log(jsonMode ? JSON.stringify(record, null, 2) : formatReplay(record));
    return;
  }

  if (command === "apply") {
    const parsed = parseArgs(args.slice(1));
    const runId = parsed.positionals[0];

    if (!runId) {
      throw new Error(
        "Missing run id. Example: trademesh apply run_20260319_001 --profile demo --approve",
      );
    }

    const record = await applyRun(runId, {
      plane: readExplicitApplyPlane(parsed.flags.plane, parsed.flags.profile),
      proposalName:
        typeof parsed.flags.proposal === "string" ? parsed.flags.proposal : undefined,
      approve: parsed.flags.approve === true,
      approvedBy: typeof parsed.flags["approved-by"] === "string" ? parsed.flags["approved-by"] : undefined,
      approvalReason:
        typeof parsed.flags["approval-reason"] === "string"
          ? parsed.flags["approval-reason"]
          : undefined,
      liveConfirm: typeof parsed.flags["live-confirm"] === "string" ? parsed.flags["live-confirm"] : undefined,
      maxOrderUsd: parsePositiveNumber(parsed.flags["max-order-usd"]),
      maxTotalUsd: parsePositiveNumber(parsed.flags["max-total-usd"]),
      execute: parsed.flags.execute === true,
    });

    console.log(jsonMode ? JSON.stringify(record, null, 2) : formatRunSummary(record));
    return;
  }

  if (command === "retry") {
    const parsed = parseArgs(args.slice(1));
    const runId = parsed.positionals[0];
    if (!runId) {
      throw new Error("Missing run id. Example: trademesh retry run_20260319_001");
    }

    const record = await retryRun(runId);
    console.log(jsonMode ? JSON.stringify(record, null, 2) : formatRunSummary(record));
    return;
  }

  if (command === "reconcile") {
    const parsed = parseArgs(args.slice(1));
    const runId = parsed.positionals[0];
    if (!runId) {
      throw new Error("Missing run id. Example: trademesh reconcile run_20260319_001");
    }

    const record = await reconcileRun(runId, {
      source: parseReconcileSource(parsed.flags.source),
      windowMin: parsePositiveNumber(parsed.flags["window-min"]),
      untilSettled: parsed.flags["until-settled"] === true,
      maxAttempts: parsePositiveInteger(parsed.flags["max-attempts"]),
      intervalSec: parsePositiveInteger(parsed.flags["interval-sec"]),
    });
    console.log(jsonMode ? JSON.stringify(record, null, 2) : formatRunSummary(record));
    return;
  }

  if (command === "export") {
    const parsed = parseArgs(args.slice(1));
    const runId = parsed.positionals[0];
    if (!runId) {
      throw new Error("Missing run id. Example: trademesh export run_20260319_001");
    }

    const exported = await exportRun(runId, {
      format: parsed.flags.format === "json" ? "json" : "md",
      outputPath: typeof parsed.flags.output === "string" ? parsed.flags.output : undefined,
    });
    console.log(jsonMode ? JSON.stringify(exported, null, 2) : exported.summary);
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
