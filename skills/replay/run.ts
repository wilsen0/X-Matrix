import { loadArtifactSnapshot, loadExecutionEnvelope, loadTraceEnvelope } from "../../runtime/trace.js";
import type {
  ArtifactKey,
  ArtifactSnapshot,
  ExecutionResult,
  PolicyDecision,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";

type JsonRecord = Record<string, unknown>;

interface TimelineEntry {
  stage: SkillOutput["stage"];
  skill: string;
  summary: string;
  timestamp: string;
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

function readSkillFilter(sharedState: Record<string, unknown>): string | undefined {
  const raw = sharedState.replaySkillFilter;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  return raw.trim().toLowerCase();
}

function normalizeExecutionResults(raw: unknown): ExecutionResult[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const record = asObject(entry);
      const intent = asObject(record?.intent);
      if (!record || !intent || !toString(intent.command) || !toString(intent.module) || !toString(intent.reason)) {
        return null;
      }

      return {
        intent: {
          command: toString(intent.command)!,
          args: Array.isArray(intent.args)
            ? intent.args.map((item) => toString(item)).filter((item): item is string => Boolean(item))
            : toString(intent.command)!.split(/\s+/),
          module: toString(intent.module)!,
          requiresWrite: intent.requiresWrite === true,
          reason: toString(intent.reason)!,
        },
        ok: record.ok === true,
        exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
        stdout: toString(record.stdout) ?? "",
        stderr: toString(record.stderr) ?? "",
        skipped: record.skipped === true,
        dryRun: record.dryRun === true,
      } satisfies ExecutionResult;
    })
    .filter((entry): entry is ExecutionResult => Boolean(entry));
}

function stableTrace(trace: SkillOutput[]): SkillOutput[] {
  return [...trace].sort((left, right) => {
    const leftTs = Date.parse(left.timestamp);
    const rightTs = Date.parse(right.timestamp);
    if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
      return leftTs - rightTs;
    }
    return left.skill.localeCompare(right.skill);
  });
}

function timeline(trace: SkillOutput[]): TimelineEntry[] {
  return trace.map((entry) => ({
    stage: entry.stage,
    skill: entry.skill,
    summary: entry.summary,
    timestamp: entry.timestamp,
  }));
}

function summarizeArtifacts(snapshot: ArtifactSnapshot): string[] {
  const orderedKeys = Object.keys(snapshot).sort() as ArtifactKey[];
  return orderedKeys.map((key) => {
    const artifact = snapshot[key];
    return `${key} <= ${artifact?.producer ?? "unknown"} v${artifact?.version ?? "?"}`;
  });
}

function summarizeEvidence(trace: SkillOutput[]): string[] {
  return trace.map((entry) => {
    const produced = entry.producedArtifacts?.join(", ") ?? "none";
    const consumed = entry.consumedArtifacts?.join(", ") ?? "none";
    const rules = entry.ruleRefs?.join(", ") ?? "none";
    const doctrines = entry.doctrineRefs?.join(", ") ?? "none";
    return `${entry.skill}: consumed=[${consumed}] produced=[${produced}] rules=[${rules}] doctrines=[${doctrines}]`;
  });
}

function summarizePolicy(decision: PolicyDecision | undefined): string {
  if (!decision) {
    return "Policy decisions: none.";
  }

  const reasons = decision.reasons.length > 0 ? ` (${decision.reasons[0]})` : "";
  return `Policy decisions: ${decision.outcome} for ${decision.proposal}${reasons}`;
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const sharedState = context.sharedState as Record<string, unknown>;
  const skillFilter = readSkillFilter(sharedState);
  const traceEnvelope = await loadTraceEnvelope(context.runId);
  const executionEnvelope = await loadExecutionEnvelope(context.runId);
  const artifactSnapshot = await loadArtifactSnapshot(context.runId);
  const baseTrace = stableTrace(traceEnvelope?.trace ?? context.trace);
  const filteredTrace = skillFilter
    ? baseTrace.filter((entry) => entry.skill.toLowerCase() === skillFilter)
    : baseTrace;
  const replayTrace = filteredTrace.length > 0 ? filteredTrace : baseTrace;
  const latestDecision = (context.artifacts.get<PolicyDecision>("execution.apply-decision")?.data ??
    context.artifacts.get<PolicyDecision>("policy.plan-decision")?.data ??
    traceEnvelope?.policyDecision) as PolicyDecision | undefined;
  const latestResults = executionEnvelope?.executions.at(-1)?.results ?? normalizeExecutionResults(sharedState.latestExecutionResults);
  const artifactLines = summarizeArtifacts(artifactSnapshot);
  const evidenceLines = summarizeEvidence(replayTrace);
  const chain = timeline(replayTrace);
  const compatibilityWarnings = Array.isArray(sharedState.replayCompatibilityWarnings)
    ? sharedState.replayCompatibilityWarnings.filter((item): item is string => typeof item === "string")
    : [];

  const facts = [
    `Replay entries: ${replayTrace.length}${skillFilter ? ` (skill filter: ${skillFilter})` : ""}.`,
    `Artifacts captured: ${artifactLines.length}.`,
    summarizePolicy(latestDecision),
    `Executions recorded: ${latestResults.length}.`,
  ];
  if (compatibilityWarnings.length > 0) {
    facts.push(`Compatibility warnings: ${compatibilityWarnings.length}.`);
  }

  if (filteredTrace.length === 0 && skillFilter) {
    facts.push(`No trace entries matched --skill ${skillFilter}; replay used the full trace.`);
  }

  return {
    skill: "replay",
    stage: "memory",
    goal: context.goal,
    summary: "Replay the run as an evidence graph so every proposal, policy decision, and execution preview is auditable.",
    facts,
    constraints: {
      traceSource: `.trademesh/runs/${context.runId}/trace.json`,
      artifactSource: `.trademesh/runs/${context.runId}/artifacts.json`,
      timelineLength: replayTrace.length,
      skillFilter: skillFilter ?? null,
    },
    proposal: [],
    risk: {
      score: 0,
      maxLoss: "None",
      needsApproval: false,
      reasons: ["Replay is read-only."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: null,
    metadata: {
      timeline: chain.map((item) => `${item.timestamp} [${item.stage}] ${item.skill}: ${item.summary}`),
      artifacts: artifactLines,
      evidence: evidenceLines,
      policyDecision: latestDecision ?? null,
      latestExecutionCount: latestResults.length,
      traceLoadedFromFile: Boolean(traceEnvelope),
      compatibilityWarnings,
    },
    timestamp: new Date().toISOString(),
  };
}
