import { loadTraceEnvelope } from "../../runtime/trace.js";
import type {
  ExecutionResult,
  OkxCommandIntent,
  PolicyDecision,
  SkillContext,
  SkillOutput,
  SkillProposal,
} from "../../runtime/types.js";

type JsonRecord = Record<string, unknown>;

interface TimelineEntry {
  index: number;
  timestampMs: number;
  timestamp: string;
  stage: SkillOutput["stage"];
  skill: string;
  summary: string;
}

function asObject(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return undefined;
}

function toString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toIntentLike(raw: unknown): OkxCommandIntent | null {
  const entry = asObject(raw);
  if (!entry) {
    return null;
  }

  const command = toString(entry.command);
  const module = toString(entry.module);
  const reason = toString(entry.reason);
  if (!command || !module || !reason) {
    return null;
  }

  const args = Array.isArray(entry.args)
    ? entry.args
        .map((item) => toString(item))
        .filter((item): item is string => Boolean(item))
    : command.split(/\s+/);

  return {
    command,
    args,
    module,
    requiresWrite: entry.requiresWrite === true,
    reason,
  };
}

function readSkillFilter(sharedState: Record<string, unknown>): string | undefined {
  const candidate = sharedState.replaySkillFilter;
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return undefined;
  }

  return candidate.trim().toLowerCase();
}

function stableSortTrace(entries: SkillOutput[]): SkillOutput[] {
  return entries
    .map((entry, index) => ({
      entry,
      index,
      timestampMs: Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : Number.NaN,
    }))
    .sort((left, right) => {
      const leftValid = Number.isFinite(left.timestampMs);
      const rightValid = Number.isFinite(right.timestampMs);
      if (leftValid && rightValid && left.timestampMs !== right.timestampMs) {
        return left.timestampMs - right.timestampMs;
      }
      if (leftValid !== rightValid) {
        return leftValid ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((item) => item.entry);
}

function summarizeSensorTriggers(sensorEntries: SkillOutput[]): string {
  if (sensorEntries.length === 0) {
    return "Sensors triggered: none.";
  }

  const labels = sensorEntries.map((entry) => {
    const firstFact = entry.facts[0];
    if (firstFact) {
      return `${entry.skill} (${firstFact})`;
    }
    return entry.skill;
  });

  return `Sensors triggered: ${labels.join(" | ")}`;
}

function summarizePlannerProposals(plannerEntries: SkillOutput[]): string {
  if (plannerEntries.length === 0) {
    return "Planner proposals: none.";
  }

  const chunks: string[] = [];
  for (const entry of plannerEntries) {
    const names = entry.proposal.map((proposal) => proposal.name);
    if (names.length === 0) {
      chunks.push(`${entry.skill}: no proposals`);
      continue;
    }

    chunks.push(`${entry.skill}: ${names.join(", ")}`);
  }

  return `Planner proposals: ${chunks.join(" | ")}`;
}

function summarizePolicyDecisions(
  guardrailEntries: SkillOutput[],
  runLevelDecision: PolicyDecision | undefined,
): string {
  const chunks: string[] = [];

  for (const entry of guardrailEntries) {
    const metadata = asObject(entry.metadata);
    const decision = toString(metadata?.decision);
    const notes = Array.isArray(metadata?.policyNotes)
      ? metadata?.policyNotes
          .map((note) => toString(note))
          .filter((note): note is string => Boolean(note))
      : [];
    if (decision) {
      chunks.push(`${entry.skill}: ${decision}${notes[0] ? ` (${notes[0]})` : ""}`);
    } else {
      chunks.push(`${entry.skill}: ${entry.summary}`);
    }
  }

  if (runLevelDecision) {
    chunks.push(
      `apply-policy: ${runLevelDecision.outcome}${
        runLevelDecision.reasons.length > 0 ? ` (${runLevelDecision.reasons[0]})` : ""
      }`,
    );
  }

  if (chunks.length === 0) {
    return "Policy decisions: none.";
  }

  return `Policy decisions: ${chunks.join(" | ")}`;
}

function extractExecutorCommands(entry: SkillOutput): string[] {
  const metadata = asObject(entry.metadata);
  if (!metadata) {
    return [];
  }

  const preview = metadata.commandPreview;
  if (Array.isArray(preview)) {
    const previewCommands = preview
      .map((item) => toString(item))
      .filter((item): item is string => Boolean(item));
    if (previewCommands.length > 0) {
      return previewCommands;
    }
  }

  const intentsRaw = metadata.intents;
  if (!Array.isArray(intentsRaw)) {
    return [];
  }

  return intentsRaw
    .map((intent) => toIntentLike(intent))
    .filter((intent): intent is OkxCommandIntent => Boolean(intent))
    .map((intent) => intent.command);
}

function summarizeExecutorActions(executorEntries: SkillOutput[], executions: ExecutionResult[]): string {
  const commands = executorEntries.flatMap((entry) => extractExecutorCommands(entry));
  const statusSummary =
    executions.length > 0
      ? `${executions.filter((item) => item.ok).length}/${executions.length} execution intents succeeded`
      : "execution results unavailable";

  if (commands.length === 0) {
    return `Executor actions: no materialized commands (${statusSummary}).`;
  }

  const preview = commands.slice(0, 4).join(" | ");
  const remain = commands.length > 4 ? ` (+${commands.length - 4} more)` : "";
  return `Executor actions: ${preview}${remain} (${statusSummary}).`;
}

function readRunLevelPolicyDecision(sharedState: Record<string, unknown>): PolicyDecision | undefined {
  const raw = asObject(sharedState.runPolicyDecision);
  if (!raw) {
    return undefined;
  }

  const outcome = raw.outcome;
  const proposal = raw.proposal;
  const plane = raw.plane;
  const evaluatedAt = raw.evaluatedAt;
  if (
    (outcome !== "approved" && outcome !== "require_approval" && outcome !== "blocked") ||
    typeof proposal !== "string" ||
    (plane !== "research" && plane !== "demo" && plane !== "live") ||
    typeof evaluatedAt !== "string"
  ) {
    return undefined;
  }

  return {
    outcome,
    proposal,
    plane,
    evaluatedAt,
    executeRequested: raw.executeRequested === true,
    approvalProvided: raw.approvalProvided === true,
    reasons: Array.isArray(raw.reasons)
      ? raw.reasons
          .map((reason) => toString(reason))
          .filter((reason): reason is string => Boolean(reason))
      : [],
  };
}

function readLatestExecutionResults(sharedState: Record<string, unknown>): ExecutionResult[] {
  const raw = sharedState.latestExecutionResults;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((result) => {
      const record = asObject(result);
      if (!record) {
        return null;
      }

      const intent = toIntentLike(record.intent);
      if (!intent) {
        return null;
      }

      return {
        intent,
        ok: record.ok === true,
        exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
        stdout: toString(record.stdout) ?? "",
        stderr: toString(record.stderr) ?? "",
        skipped: record.skipped === true,
        dryRun: record.dryRun === true,
      } satisfies ExecutionResult;
    })
    .filter((result): result is ExecutionResult => Boolean(result));
}

function toTimeline(entries: SkillOutput[]): TimelineEntry[] {
  return entries.map((entry, index) => ({
    index,
    timestampMs: Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : Number.NaN,
    timestamp: entry.timestamp,
    stage: entry.stage,
    skill: entry.skill,
    summary: entry.summary,
  }));
}

function summarizeTimeline(timeline: TimelineEntry[]): string[] {
  return timeline.map((item) => {
    const normalizedTimestamp =
      Number.isFinite(item.timestampMs) && item.timestamp
        ? item.timestamp
        : `index-${item.index + 1}`;
    return `${normalizedTimestamp} [${item.stage}] ${item.skill}: ${item.summary}`;
  });
}

function normalizeProposals(plannerEntries: SkillOutput[]): SkillProposal[] {
  const plannerWithProposal = [...plannerEntries].reverse().find((entry) => entry.proposal.length > 0);
  return plannerWithProposal?.proposal ?? [];
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const sharedState = context.sharedState as Record<string, unknown>;
  const skillFilter = readSkillFilter(sharedState);
  const traceEnvelope = await loadTraceEnvelope(context.runId);
  const baseTrace = traceEnvelope?.trace ?? context.trace;
  const orderedTrace = stableSortTrace(baseTrace);
  const filteredTrace = skillFilter
    ? orderedTrace.filter((entry) => entry.skill.toLowerCase() === skillFilter)
    : orderedTrace;
  const replayTrace = filteredTrace.length > 0 ? filteredTrace : orderedTrace;
  const sensors = replayTrace.filter((entry) => entry.stage === "sensor");
  const planners = replayTrace.filter((entry) => entry.stage === "planner");
  const guardrails = replayTrace.filter((entry) => entry.stage === "guardrail");
  const executors = replayTrace.filter((entry) => entry.stage === "executor");
  const runLevelDecision = readRunLevelPolicyDecision(sharedState);
  const latestResults = readLatestExecutionResults(sharedState);
  const timeline = toTimeline(replayTrace);
  const timelineSummary = summarizeTimeline(timeline);
  const proposalSummary = normalizeProposals(planners);

  const sourcePath = `.trademesh/runs/${context.runId}/trace.json`;
  const facts = [
    `Replay source: ${sourcePath}${traceEnvelope ? "" : " (missing, fallback to run trace)"}.`,
    `Replay entries: ${replayTrace.length}${skillFilter ? ` (skill filter: ${skillFilter})` : ""}.`,
    summarizeSensorTriggers(sensors),
    summarizePlannerProposals(planners),
    summarizePolicyDecisions(guardrails, runLevelDecision),
    summarizeExecutorActions(executors, latestResults),
  ];

  if (skillFilter && filteredTrace.length === 0) {
    facts.push(`No trace entries matched --skill ${skillFilter}; fallback timeline was used.`);
  }

  return {
    skill: "replay",
    stage: "memory",
    goal: context.goal,
    summary: "Replay the run trace in chronological order and synthesize the sensor→planner→policy→executor decision chain.",
    facts,
    constraints: {
      traceSource: sourcePath,
      skillFilter: skillFilter ?? null,
      timelineLength: replayTrace.length,
    },
    proposal: proposalSummary,
    risk: {
      score: 0,
      maxLoss: "None",
      needsApproval: false,
      reasons: ["Replay is read-only and audit-focused."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: null,
    metadata: {
      timeline: timelineSummary,
      skillFilter: skillFilter ?? null,
      sensorCount: sensors.length,
      plannerCount: planners.length,
      guardrailCount: guardrails.length,
      executorCount: executors.length,
      sourcePath,
      traceLoadedFromFile: Boolean(traceEnvelope),
    },
    timestamp: new Date().toISOString(),
  };
}
