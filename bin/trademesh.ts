#!/usr/bin/env node

import process from "node:process";
import {
  applyRun,
  createPlan,
  formatReplay,
  formatRunSummary,
  listRuns,
  printSkillList,
  replayRun,
  retryRun,
} from "../runtime/executor.js";
import { runDoctor } from "../runtime/doctor.js";
import type { ExecutionPlane } from "../runtime/types.js";

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
  trademesh doctor
  trademesh skills ls|list
  trademesh runs list
  trademesh plan "<goal>" [--plane research|demo|live] [--profile demo|live] [--json]
  trademesh replay <run-id> [--skill <name>] [--json]
  trademesh retry <run-id> [--json]
  trademesh apply <run-id> [--plane demo|live] [--profile demo|live] [--proposal <name>] [--approve] [--execute] [--json]`);
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const jsonMode = args.includes("--json");

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "doctor") {
    const report = await runDoctor();
    console.log(jsonMode ? JSON.stringify(report, null, 2) : report.summary);
    return;
  }

  if (command === "skills" && (args[1] === "ls" || args[1] === "list")) {
    const listing = await printSkillList();
    console.log(jsonMode ? JSON.stringify(listing, null, 2) : listing.summary);
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

  printHelp();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
