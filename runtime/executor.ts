import { existsSync, promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { executeIntent, inspectOkxEnvironment, runOkxJson } from "./okx.js";
import { createArtifactStore, putArtifact } from "./artifacts.js";
import { currentArtifactVersion } from "./artifact-schema.js";
import { runExplicitRoute, runPlanningGraph } from "./graph-runtime.js";
import { formatDrawdownPct } from "./goal-intake.js";
import {
  checkWriteIntentIdempotency,
  deriveClientOrderRef,
  fingerprintWriteIntent,
  IdempotencyLockError,
  loadIdempotencyLedger,
  markWriteIntentAmbiguous,
  markWriteIntentExecuted,
  markWriteIntentPending,
} from "./idempotency.js";
import { buildSkillGraphView, inspectSkillSurface, type SkillGraphView, type SkillRuntimeSurface } from "./mesh.js";
import { getProjectPaths } from "./paths.js";
import { evaluatePolicy } from "./policy.js";
import { loadSkillHandler, loadSkillRegistry } from "./registry.js";
import { seedReasons } from "./router.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import {
  createRunId,
  listRunIds,
  loadArtifactSnapshot,
  loadRun,
  saveArtifactSnapshot,
  saveRun,
} from "./trace.js";
import type {
  ArtifactSnapshot,
  ArtifactStore,
  ApprovalTicket,
  CapabilitySnapshot,
  CommandPreviewEntry,
  EnvironmentDiagnosis,
  ExecutionErrorCategory,
  ExecutionPlane,
  ExecutionRecord,
  ExecutionResult,
  GoalIntake,
  GoalIntakeOverrides,
  OperatorSummaryV3,
  OkxCommandIntent,
  OrderPlanStep,
  PolicyDecision,
  ReconciliationItem,
  ReconciliationReport,
  RunErrorRecord,
  RunRecord,
  RunStatus,
  SkillContext,
  SkillManifest,
  SkillOutput,
  SkillPermissions,
  SkillProposal,
  SkillRisk,
} from "./types.js";

interface PlanOptions {
  plane: ExecutionPlane;
  goalOverrides?: GoalIntakeOverrides;
}

interface StandaloneOptions {
  plane: ExecutionPlane;
  goalOverrides?: GoalIntakeOverrides;
  inputArtifacts?: ArtifactSnapshot;
}

interface ApplyOptions {
  plane?: ExecutionPlane;
  proposalName?: string;
  approve?: boolean;
  approvedBy?: string;
  approvalReason?: string;
  liveConfirm?: string;
  maxOrderUsd?: number;
  maxTotalUsd?: number;
  execute?: boolean;
}

interface ReplayOptions {
  skill?: string;
}

interface DemoOptions {
  plane: ExecutionPlane;
  execute?: boolean;
  goalOverrides?: GoalIntakeOverrides;
}

interface ExportOptions {
  format?: "md" | "json";
  outputPath?: string;
}

interface ReconcileOptions {
  source?: "auto" | "client-id" | "fallback";
  windowMin?: number;
}

interface RehearseOptions {
  execute?: boolean;
  approve?: boolean;
}

interface ExecutionBundle {
  proposal: string;
  orderPlan: OrderPlanStep[];
  intents: OkxCommandIntent[];
  commandPreview?: CommandPreviewEntry[];
}

export interface DemoSession {
  doctor: DoctorReport;
  graph: SkillGraphView;
  planned: RunRecord;
  applied: RunRecord;
  replayed: RunRecord;
  summary: string;
}

export interface ExportResult {
  runId: string;
  outputDir: string;
  bundlePath: string;
  reportPath: string;
  operatorSummaryPath: string;
  summary: string;
}

type HydrateInput = Omit<
  RunRecord,
  | "facts"
  | "constraints"
  | "proposals"
  | "risk"
  | "permissions"
  | "approved"
  | "capabilitySnapshot"
  | "executions"
  | "errors"
> & {
  capabilitySnapshot?: CapabilitySnapshot;
  executions?: ExecutionRecord[];
  errors?: RunErrorRecord[];
  policyDecision?: PolicyDecision;
  legacyProposals?: SkillProposal[];
};

const RUN_STATUS_SET = new Set<RunStatus>([
  "planned",
  "approval_required",
  "ready",
  "blocked",
  "dry_run",
  "executed",
  "failed",
  "previewed",
]);

function now(): string {
  return new Date().toISOString();
}

function allowedModulesForPlane(plane: ExecutionPlane): string[] {
  if (plane === "research") {
    return ["account", "market"];
  }

  return ["account", "market", "swap", "option"];
}

function createFallbackCapabilitySnapshot(): CapabilitySnapshot {
  return {
    okxCliAvailable: false,
    configPath: "profiles",
    configExists: false,
    demoProfileLikelyConfigured: false,
    liveProfileLikelyConfigured: false,
    readinessGrade: "D",
    blockers: ["Capability snapshot was missing on this run file."],
    recommendedPlane: "research",
    warnings: ["Capability snapshot was missing on this run file."],
  };
}

function exportPaths(runId: string, outputPath?: string): {
  outputDir: string;
  bundlePath: string;
  reportPath: string;
  operatorSummaryPath: string;
} {
  const { meshExportsRoot } = getProjectPaths();
  const outputDir = outputPath ? resolve(outputPath) : join(meshExportsRoot, runId);
  return {
    outputDir,
    bundlePath: join(outputDir, "bundle.json"),
    reportPath: join(outputDir, "report.md"),
    operatorSummaryPath: join(outputDir, "operator-summary.json"),
  };
}

function hasExportBundle(runId: string): boolean {
  const paths = exportPaths(runId);
  return existsSync(paths.bundlePath) && existsSync(paths.reportPath) && existsSync(paths.operatorSummaryPath);
}

function goalIntakeFromArtifacts(artifacts: ArtifactStore): GoalIntake | undefined {
  return artifacts.get<GoalIntake>("goal.intake")?.data;
}

function previewEntryFromIntent(intent: OkxCommandIntent): CommandPreviewEntry {
  return {
    intentId: intent.intentId,
    stepIndex: intent.stepIndex,
    module: intent.module,
    requiresWrite: intent.requiresWrite,
    safeToRetry: intent.safeToRetry,
    clientOrderRef: intent.clientOrderRef,
    reason: intent.reason,
    command: intent.command,
  };
}

function normalizeProposal(proposal: SkillProposal): SkillProposal {
  const intents = proposal.intents ?? [];
  const requiredModules = proposal.requiredModules && proposal.requiredModules.length > 0
    ? proposal.requiredModules
    : [...new Set(intents.map((intent) => intent.module))];

  return {
    ...proposal,
    intents,
    requiredModules,
  };
}

async function executeSkill(
  manifest: SkillManifest,
  context: Omit<SkillContext, "manifest">,
): Promise<SkillOutput> {
  const handler = await loadSkillHandler(manifest);
  if (!handler) {
    return {
      skill: manifest.name,
      stage: manifest.stage,
      goal: context.goal,
      summary: manifest.description || `Manifest-only skill ${manifest.name} was discovered.`,
      facts: [`No runtime handler is installed for ${manifest.name}. Using manifest-only fallback.`],
      constraints: {
        manifestOnly: true,
        requiredModules: manifest.requires,
      },
      proposal: [],
      risk: {
        score: manifest.riskLevel === "high" ? 0.7 : manifest.riskLevel === "medium" ? 0.35 : 0.1,
        maxLoss: "No execution performed",
        needsApproval: manifest.writes || context.plane !== "research",
        reasons: ["Skill is available for routing but has no local runtime handler."],
      },
      permissions: {
        plane: context.plane,
        officialWriteOnly: true,
        allowedModules: manifest.requires,
      },
      handoff: null,
      metadata: {
        source: "manifest-only",
      },
      timestamp: new Date().toISOString(),
    };
  }

  return handler({
    ...context,
    manifest,
  });
}

function mergeConstraintValue(current: unknown, incoming: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(incoming)) {
    return [...new Set([...current, ...incoming])];
  }

  if (
    current &&
    incoming &&
    typeof current === "object" &&
    typeof incoming === "object" &&
    !Array.isArray(current) &&
    !Array.isArray(incoming)
  ) {
    return { ...(current as Record<string, unknown>), ...(incoming as Record<string, unknown>) };
  }

  return incoming;
}

function collectFacts(trace: SkillOutput[]): string[] {
  const facts = trace.flatMap((entry) => entry.facts);
  return [...new Set(facts)];
}

function collectConstraints(trace: SkillOutput[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const entry of trace) {
    for (const [key, value] of Object.entries(entry.constraints)) {
      merged[key] = key in merged ? mergeConstraintValue(merged[key], value) : value;
    }
  }
  return merged;
}

function collectProposals(trace: SkillOutput[]): SkillProposal[] {
  const proposalOwner = [...trace].reverse().find((entry) => entry.proposal.length > 0);
  return (proposalOwner?.proposal ?? []).map(normalizeProposal);
}

function pickRunRisk(trace: SkillOutput[]): SkillRisk {
  const latest = [...trace].reverse().find((entry) => entry.risk);
  if (latest) {
    return latest.risk;
  }

  return {
    score: 0,
    maxLoss: "Unknown",
    needsApproval: false,
    reasons: [],
  };
}

function pickRunPermissions(trace: SkillOutput[], plane: ExecutionPlane): SkillPermissions {
  const latest = [...trace].reverse().find((entry) => entry.permissions);
  return (
    latest?.permissions ?? {
      plane,
      officialWriteOnly: true,
      allowedModules: allowedModulesForPlane(plane),
    }
  );
}

function deriveApproved(
  status: RunRecord["status"],
  policyDecision?: PolicyDecision,
): boolean {
  if (policyDecision?.outcome === "approved") {
    return true;
  }

  return ["executed", "dry_run", "ready", "previewed"].includes(status);
}

function normalizeStatus(status: RunRecord["status"] | undefined): RunRecord["status"] {
  if (status === "previewed") {
    return "dry_run";
  }

  if (status && RUN_STATUS_SET.has(status)) {
    return status;
  }

  return "planned";
}

function summarizeRouteReason(goal: string, manifest: SkillManifest): string {
  const reasons = seedReasons(goal, manifest);
  return `${manifest.name}: ${reasons.join(" | ")}`;
}

function buildRouteSummary(
  goal: string,
  manifests: SkillManifest[],
  route: string[],
): RunRecord["routeSummary"] {
  const selected = new Set(route);
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const reasons = route.map((name) => {
    const manifest = byName.get(name);
    return manifest ? summarizeRouteReason(goal, manifest) : `${name}: selected`;
  });

  return {
    selectedSkills: [...route],
    skippedSkills: manifests
      .map((manifest) => manifest.name)
      .filter((name) => !selected.has(name)),
    reasons,
  };
}

function preferredProposalName(proposals: SkillProposal[]): string | undefined {
  return proposals.find((proposal) => proposal.recommended)?.name ?? proposals[0]?.name;
}

function buildJudgeSummary(record: RunRecord): RunRecord["judgeSummary"] {
  const latestExecution = record.executions.at(-1);
  const selectedProposal = record.selectedProposal ?? preferredProposalName(record.proposals);
  const headline = latestExecution
    ? `Guarded runtime ${latestExecution.mode === "execute" ? "executed" : "previewed"} ${selectedProposal ?? "a proposal"} on ${record.plane}.`
    : `Guarded runtime planned ${selectedProposal ?? "a proposal"} on ${record.plane}.`;

  return {
    headline,
    selectedProposal,
    policyVerdict: record.policyDecision?.outcome ?? "none",
    executionVerdict: latestExecution?.status ?? "plan_only",
  };
}

function hydrateRecord(record: HydrateInput): RunRecord {
  const facts = collectFacts(record.trace);
  const constraints = collectConstraints(record.trace);
  const proposalsFromTrace = collectProposals(record.trace);
  const proposals = proposalsFromTrace.length > 0
    ? proposalsFromTrace
    : (record.legacyProposals ?? []).map(normalizeProposal);
  const risk = pickRunRisk(record.trace);
  const permissions = pickRunPermissions(record.trace, record.plane);

  const hydrated: RunRecord = {
    ...record,
    version: 3,
    status: normalizeStatus(record.status),
    routeKind: record.routeKind ?? "workflow",
    facts,
    constraints,
    proposals,
    risk,
    permissions,
    capabilitySnapshot: record.capabilitySnapshot ?? createFallbackCapabilitySnapshot(),
    executions: record.executions ?? [],
    errors: record.errors ?? [],
    approved: deriveApproved(record.status, record.policyDecision),
  };

  hydrated.judgeSummary = record.judgeSummary ?? buildJudgeSummary(hydrated);
  hydrated.routeSummary = record.routeSummary ?? {
    selectedSkills: [...hydrated.route],
    skippedSkills: [],
    reasons: [],
  };

  return hydrated;
}

async function loadNormalizedRun(runId: string): Promise<RunRecord> {
  const loaded = await loadRun(runId);
  const capabilitySnapshot = loaded.capabilitySnapshot ?? (await inspectOkxEnvironment());

  return hydrateRecord({
    kind: "trademesh-run",
    version: 3,
    id: loaded.id,
    goal: loaded.goal,
    plane: loaded.plane,
    status: loaded.status,
    routeKind: loaded.routeKind ?? "workflow",
    entrySkill: loaded.entrySkill,
    route: loaded.route,
    trace: loaded.trace,
    notes: loaded.notes ?? [],
    createdAt: loaded.createdAt,
    updatedAt: loaded.updatedAt,
    selectedProposal: loaded.selectedProposal,
    routeSummary: loaded.routeSummary,
    judgeSummary: loaded.judgeSummary,
    policyDecision: loaded.policyDecision,
    legacyProposals: loaded.proposals ?? [],
    capabilitySnapshot,
    executions: loaded.executions ?? [],
    errors: loaded.errors ?? [],
  });
}

function planningRouteWithTail(route: string[], manifests: SkillManifest[]): string[] {
  const installed = new Set(manifests.map((manifest) => manifest.name));
  const finalRoute = [...route];
  for (const tail of ["official-executor", "replay"]) {
    if (installed.has(tail) && !finalRoute.includes(tail)) {
      finalRoute.push(tail);
    }
  }
  return finalRoute;
}

function latestTraceEntry(trace: SkillOutput[], skillName: string): SkillOutput | undefined {
  return [...trace].reverse().find((entry) => entry.skill === skillName);
}

function proposalsFromArtifacts(artifacts: ArtifactStore): SkillProposal[] {
  const artifact = artifacts.get<SkillProposal[]>("planning.proposals")?.data;
  return Array.isArray(artifact) ? artifact.map(normalizeProposal) : [];
}

function resolveProposal(
  artifacts: ArtifactStore,
  proposalName?: string,
): SkillProposal {
  const proposals = proposalsFromArtifacts(artifacts);
  if (proposals.length === 0) {
    throw new Error("Artifact snapshot is missing 'planning.proposals'. Recreate the plan with the current runtime.");
  }

  if (proposalName) {
    const explicit = proposals.find((proposal) => proposal.name === proposalName);
    if (!explicit) {
      throw new Error(`Proposal '${proposalName}' was not found in the artifact snapshot.`);
    }
    return explicit;
  }

  return proposals.find((proposal) => proposal.recommended) ?? proposals[0];
}

function extractExecutionBundle(artifacts: ArtifactStore, proposal: SkillProposal): ExecutionBundle {
  const artifactData = artifacts.get<ExecutionBundle>("execution.intent-bundle")?.data;
  if (artifactData && Array.isArray(artifactData.intents)) {
    return artifactData;
  }

  const normalized = normalizeProposal(proposal);
  return {
    proposal: normalized.name,
    orderPlan: normalized.orderPlan ?? [],
    intents: normalized.intents ?? [],
    commandPreview: (normalized.intents ?? []).map((intent) => previewEntryFromIntent(intent)),
  };
}

function skippedResult(
  intent: OkxCommandIntent,
  executeRequested: boolean,
  reason: string,
): ExecutionResult {
  const ts = now();
  return {
    intent,
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: reason,
    skipped: true,
    dryRun: !executeRequested,
    startedAt: ts,
    finishedAt: ts,
    durationMs: 0,
  };
}

function skippedIdempotentResult(intent: OkxCommandIntent): ExecutionResult {
  const ts = now();
  return {
    intent,
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "skipped(idempotent-hit)",
    skipped: true,
    dryRun: false,
    startedAt: ts,
    finishedAt: ts,
    durationMs: 0,
  };
}

function parseRemoteOrderId(stdout: string): string | undefined {
  if (!stdout || stdout.trim().length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }

  const response = parsed as { data?: unknown };
  if (!Array.isArray(response.data)) {
    return undefined;
  }

  for (const row of response.data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }

    const orderId = (row as { ordId?: unknown }).ordId;
    if (typeof orderId === "string" && orderId.trim().length > 0) {
      return orderId.trim();
    }
  }

  return undefined;
}

interface ExecutionWithRecovery {
  results: ExecutionResult[];
  errors: RunErrorRecord[];
  finalResults: ExecutionResult[];
  idempotencyChecked?: boolean;
  idempotentHitCount?: number;
  idempotencyLedgerSeq?: number;
  blockedByIdempotency?: string;
  blockedReconciliationState?: "pending" | "ambiguous";
  nextSafeAction?: string;
}

function classifyExecutionFailure(result: ExecutionResult): ExecutionErrorCategory {
  const message = `${result.stderr}\n${result.stdout}`.toLowerCase();
  const fatalPatterns = [
    "insufficient balance",
    "insufficient margin",
    "insufficient",
    "not enough balance",
    "余额不足",
    "保证金不足",
  ];
  if (fatalPatterns.some((pattern) => message.includes(pattern))) {
    return "fatal";
  }

  const retryablePatterns = [
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "connection reset",
    "network",
    "socket hang up",
    "temporarily unavailable",
    "gateway timeout",
    "status 502",
    "status 503",
  ];
  if (retryablePatterns.some((pattern) => message.includes(pattern))) {
    return "retryable";
  }

  return "fatal";
}

function normalizeFailureMessage(result: ExecutionResult): string {
  if (result.stderr.trim().length > 0) {
    return result.stderr.trim();
  }

  if (result.stdout.trim().length > 0) {
    return result.stdout.trim();
  }

  if (result.exitCode !== null) {
    return `Command exited with code ${result.exitCode}.`;
  }

  return "Unknown execution failure.";
}

function buildRunErrorRecord(
  runId: string,
  proposal: string,
  intent: OkxCommandIntent,
  result: ExecutionResult,
  category: ExecutionErrorCategory,
  attempt: number,
  retried: boolean,
): RunErrorRecord {
  return {
    at: now(),
    runId,
    proposal,
    intent,
    module: intent.module,
    exitCode: result.exitCode,
    category,
    message: normalizeFailureMessage(result),
    attempt,
    retried,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function executeWithRecovery(
  intents: OkxCommandIntent[],
  options: { runId: string; proposal: string; executeRequested: boolean },
): Promise<ExecutionWithRecovery> {
  if (!options.executeRequested) {
    const dryRunResults = intents.map((intent) => executeIntent(intent, false));
    return {
      results: dryRunResults,
      errors: [],
      finalResults: dryRunResults,
    };
  }

  const results: ExecutionResult[] = [];
  const errors: RunErrorRecord[] = [];
  const finalResults: ExecutionResult[] = [];

  for (let index = 0; index < intents.length; index += 1) {
    const intent = intents[index];
    const firstAttempt = executeIntent(intent, true);
    firstAttempt.attempt = 1;
    if (firstAttempt.ok) {
      results.push(firstAttempt);
      finalResults.push(firstAttempt);
      continue;
    }

    const category = classifyExecutionFailure(firstAttempt);
    firstAttempt.errorCategory = category;
    if (category === "retryable" && intent.safeToRetry) {
      firstAttempt.retryScheduled = true;
    }
    results.push(firstAttempt);
    errors.push(
      buildRunErrorRecord(
        options.runId,
        options.proposal,
        intent,
        firstAttempt,
        category,
        1,
        category === "retryable" && intent.safeToRetry,
      ),
    );

    if (category === "retryable" && intent.safeToRetry) {
      await sleep(2_000);
      const secondAttempt = executeIntent(intent, true);
      secondAttempt.attempt = 2;
      if (secondAttempt.ok) {
        results.push(secondAttempt);
        finalResults.push(secondAttempt);
        continue;
      }

      const secondCategory = classifyExecutionFailure(secondAttempt);
      secondAttempt.errorCategory = secondCategory;
      results.push(secondAttempt);
      finalResults.push(secondAttempt);
      errors.push(buildRunErrorRecord(options.runId, options.proposal, intent, secondAttempt, secondCategory, 2, false));
    } else {
      finalResults.push(firstAttempt);
    }

    for (let remaining = index + 1; remaining < intents.length; remaining += 1) {
      const skipped = skippedResult(
        intents[remaining],
        true,
        "Execution aborted because a previous intent failed and was classified as non-recoverable.",
      );
      results.push(skipped);
      finalResults.push(skipped);
    }
    break;
  }

  return { results, errors, finalResults };
}

async function executeApplyWithIdempotency(
  intents: OkxCommandIntent[],
  options: {
    runId: string;
    proposal: string;
    plane: ExecutionPlane;
    executeRequested: boolean;
  },
): Promise<ExecutionWithRecovery> {
  if (!options.executeRequested) {
    const dryRunResults = intents.map((intent) => executeIntent(intent, false));
    return {
      results: dryRunResults,
      errors: [],
      finalResults: dryRunResults,
      idempotencyChecked: false,
      idempotentHitCount: 0,
    };
  }

  const writeIntents = intents.filter((intent) => intent.requiresWrite);
  if (writeIntents.length === 0) {
    const executed = await executeWithRecovery(intents, {
      runId: options.runId,
      proposal: options.proposal,
      executeRequested: true,
    });
    return {
      ...executed,
      idempotencyChecked: true,
      idempotentHitCount: 0,
    };
  }

  const preChecks = new Map<string, Awaited<ReturnType<typeof checkWriteIntentIdempotency>>>();
  try {
    for (const intent of writeIntents) {
      const check = await checkWriteIntentIdempotency(intent, options.plane);
      preChecks.set(intent.intentId, check);
      if (check.status === "pending" || check.status === "ambiguous") {
        const reason = check.status === "ambiguous"
          ? "Write intent is ambiguous in idempotency ledger. Run `trademesh reconcile <run-id>` before re-execution."
          : "Write intent is pending in idempotency ledger. Run `trademesh reconcile <run-id>` before re-execution.";
        const skipped = intents.map((entry) => skippedResult(entry, true, reason));
        return {
          results: skipped,
          errors: [],
          finalResults: skipped,
          idempotencyChecked: true,
          idempotentHitCount: 0,
          blockedByIdempotency: reason,
          blockedReconciliationState: check.status === "ambiguous" ? "ambiguous" : "pending",
          nextSafeAction: `node dist/bin/trademesh.js reconcile ${options.runId}`,
        };
      }
    }
  } catch (error) {
    if (error instanceof IdempotencyLockError) {
      const skipped = intents.map((entry) => skippedResult(entry, true, error.message));
      return {
        results: skipped,
        errors: [],
        finalResults: skipped,
        idempotencyChecked: true,
        idempotentHitCount: 0,
        blockedByIdempotency: error.message,
        blockedReconciliationState: "pending",
        nextSafeAction: error.nextSafeAction,
      };
    }
    throw error;
  }

  const results: ExecutionResult[] = [];
  const errors: RunErrorRecord[] = [];
  const finalResults: ExecutionResult[] = [];
  let idempotentHitCount = 0;

  for (let index = 0; index < intents.length; index += 1) {
    const intent = intents[index];
    const check = intent.requiresWrite ? preChecks.get(intent.intentId) : undefined;
    if (intent.requiresWrite && check?.status === "executed_hit") {
      idempotentHitCount += 1;
      const hit = skippedIdempotentResult(intent);
      results.push(hit);
      finalResults.push(hit);
      continue;
    }

    const fingerprint = intent.requiresWrite
      ? (check?.fingerprint ?? fingerprintWriteIntent(intent, options.plane))
      : undefined;
    if (intent.requiresWrite && fingerprint) {
      try {
        await markWriteIntentPending({
          fingerprint,
          intent,
          runId: options.runId,
          proposal: options.proposal,
          plane: options.plane,
        });
      } catch (error) {
        if (error instanceof IdempotencyLockError) {
          const reason = error.message;
          const blocked = skippedResult(intent, true, reason);
          results.push(blocked);
          finalResults.push(blocked);
          for (let remaining = index + 1; remaining < intents.length; remaining += 1) {
            const skipped = skippedResult(intents[remaining], true, reason);
            results.push(skipped);
            finalResults.push(skipped);
          }
          return {
            results,
            errors,
            finalResults,
            idempotencyChecked: true,
            idempotentHitCount,
            blockedByIdempotency: reason,
            blockedReconciliationState: "pending",
            nextSafeAction: error.nextSafeAction,
          };
        }
        throw error;
      }
    }

    const firstAttempt = executeIntent(intent, true);
    firstAttempt.attempt = 1;
    if (firstAttempt.ok) {
      if (intent.requiresWrite && fingerprint) {
        try {
          await markWriteIntentExecuted({
            fingerprint,
            remoteOrderId: parseRemoteOrderId(firstAttempt.stdout),
          });
        } catch (error) {
          if (!(error instanceof IdempotencyLockError)) {
            throw error;
          }
        }
      }
      results.push(firstAttempt);
      finalResults.push(firstAttempt);
      continue;
    }

    const category = classifyExecutionFailure(firstAttempt);
    firstAttempt.errorCategory = category;
    if (category === "retryable" && intent.safeToRetry) {
      firstAttempt.retryScheduled = true;
    }
    results.push(firstAttempt);
    errors.push(
      buildRunErrorRecord(
        options.runId,
        options.proposal,
        intent,
        firstAttempt,
        category,
        1,
        category === "retryable" && intent.safeToRetry,
      ),
    );

    if (intent.requiresWrite && fingerprint) {
      try {
        await markWriteIntentAmbiguous({
          fingerprint,
          lastError: normalizeFailureMessage(firstAttempt),
        });
      } catch (error) {
        if (!(error instanceof IdempotencyLockError)) {
          throw error;
        }
      }
    }

    if (category === "retryable" && intent.safeToRetry) {
      await sleep(2_000);
      const secondAttempt = executeIntent(intent, true);
      secondAttempt.attempt = 2;
      if (secondAttempt.ok) {
        results.push(secondAttempt);
        finalResults.push(secondAttempt);
        continue;
      }

      const secondCategory = classifyExecutionFailure(secondAttempt);
      secondAttempt.errorCategory = secondCategory;
      results.push(secondAttempt);
      finalResults.push(secondAttempt);
      errors.push(buildRunErrorRecord(options.runId, options.proposal, intent, secondAttempt, secondCategory, 2, false));
    } else {
      finalResults.push(firstAttempt);
    }

    for (let remaining = index + 1; remaining < intents.length; remaining += 1) {
      const skipped = skippedResult(
        intents[remaining],
        true,
        "Execution aborted because a previous intent failed and was classified as non-recoverable.",
      );
      results.push(skipped);
      finalResults.push(skipped);
    }
    break;
  }

  const ledger = await loadIdempotencyLedger();
  return {
    results,
    errors,
    finalResults,
    idempotencyChecked: true,
    idempotentHitCount,
    idempotencyLedgerSeq: Math.max(ledger.nextSeq - 1, 0),
  };
}

function nextStatusFromPolicy(
  outcome: PolicyDecision["outcome"],
  executeRequested: boolean,
  executionOk: boolean,
): RunStatus {
  if (outcome === "blocked") {
    return "blocked";
  }

  if (outcome === "require_approval") {
    return "approval_required";
  }

  if (!executionOk) {
    return "failed";
  }

  return executeRequested ? "executed" : "dry_run";
}

function initialPlanStatus(policyDecision: PolicyDecision | undefined): RunStatus {
  if (!policyDecision) {
    return "planned";
  }
  if (policyDecision.outcome === "blocked") {
    return "blocked";
  }
  if (policyDecision.outcome === "require_approval") {
    return "approval_required";
  }
  return "ready";
}

export async function createPlan(goal: string, options: PlanOptions): Promise<RunRecord> {
  const manifests = await loadSkillRegistry();
  const runId = await createRunId();
  const capabilitySnapshot = await inspectOkxEnvironment();
  const sharedState: Record<string, unknown> = {};
  const artifacts = createArtifactStore(undefined, sharedState);
  const graph = await runPlanningGraph({
    goal,
    manifests,
    executeSkill,
    context: {
      runId,
      goal,
      plane: options.plane,
      manifests,
      trace: [],
      artifacts,
      runtimeInput: {
        capabilitySnapshot,
        goalOverrides: options.goalOverrides ?? {},
      },
      sharedState,
    },
  });
  const policyDecision = artifacts.get<PolicyDecision>("policy.plan-decision")?.data;
  const proposals = proposalsFromArtifacts(artifacts);
  const selectedProposal = preferredProposalName(proposals);
  const route = planningRouteWithTail(graph.route, manifests);

  const record = hydrateRecord({
    kind: "trademesh-run",
    version: 3,
    id: runId,
    goal,
    plane: options.plane,
    status: initialPlanStatus(policyDecision),
    routeKind: "workflow",
    route,
    trace: graph.trace,
    selectedProposal,
    policyDecision,
    capabilitySnapshot,
    routeSummary: buildRouteSummary(goal, manifests, route),
    executions: [],
    errors: [],
    notes: [
      "Plan created from the local skill registry.",
      "Planning executed through the graph-aware artifact runtime.",
      ...(options.goalOverrides
        ? ["Goal intake overrides were applied before portfolio and hedge planning."]
        : []),
      "Use apply --proposal <name> to select an execution path.",
      "Use --approve and --execute for explicit write execution.",
      `Initial plane: ${options.plane}`,
    ],
    createdAt: now(),
    updatedAt: now(),
  });
  putOperatorSummaryArtifact(artifacts, record, "rehearse-runtime");

  await saveRun(record);
  await saveArtifactSnapshot(runId, artifacts.snapshot());
  return record;
}

function assertStandaloneOutputs(manifest: SkillManifest, artifacts: ArtifactStore): void {
  if (manifest.name === "replay") {
    return;
  }

  const missing = manifest.standaloneOutputs.filter((key) => !artifacts.has(key));
  if (missing.length > 0) {
    throw new Error(
      `Standalone run for '${manifest.name}' did not produce required artifacts: ${missing.join(", ")}.`,
    );
  }
}

export async function runSkillStandalone(
  skillName: string,
  goal: string,
  options: StandaloneOptions,
): Promise<RunRecord> {
  const manifests = await loadSkillRegistry();
  const manifest = manifests.find((entry) => entry.name === skillName);
  if (!manifest) {
    throw new Error(`Skill '${skillName}' was not found in the local registry.`);
  }

  const runId = await createRunId();
  const capabilitySnapshot = await inspectOkxEnvironment();
  const sharedState: Record<string, unknown> = {};
  const artifacts = createArtifactStore(options.inputArtifacts, sharedState);
  const graph = await runExplicitRoute({
    route: manifest.standaloneRoute,
    manifests,
    executeSkill,
    context: {
      runId,
      goal,
      plane: options.plane,
      manifests,
      trace: [],
      artifacts,
      runtimeInput: {
        capabilitySnapshot,
        goalOverrides: options.goalOverrides ?? {},
        replaySourceRunId: skillName === "replay" ? goal : undefined,
      },
      sharedState,
    },
  });
  assertStandaloneOutputs(manifest, artifacts);

  const policyDecision = artifacts.get<PolicyDecision>("policy.plan-decision")?.data;
  const proposals = proposalsFromArtifacts(artifacts);
  const selectedProposal = preferredProposalName(proposals);
  const route = [...graph.route];
  const record = hydrateRecord({
    kind: "trademesh-run",
    version: 3,
    id: runId,
    goal,
    plane: options.plane,
    status: initialPlanStatus(policyDecision),
    routeKind: "standalone",
    entrySkill: skillName,
    route,
    trace: graph.trace,
    selectedProposal,
    policyDecision,
    capabilitySnapshot,
    routeSummary: buildRouteSummary(goal, manifests, route),
    executions: [],
    errors: [],
    notes: [
      `Standalone route executed for skill '${skillName}'.`,
      `Standalone route: ${route.join(" -> ")}`,
      `Selected plane: ${options.plane}`,
    ],
    createdAt: now(),
    updatedAt: now(),
  });

  await saveRun(record);
  await saveArtifactSnapshot(runId, artifacts.snapshot());
  return record;
}

export async function applyRun(runId: string, options: ApplyOptions): Promise<RunRecord> {
  const baseRecord = await loadNormalizedRun(runId);
  const manifests = await loadSkillRegistry();
  const executorManifest = manifests.find((manifest) => manifest.name === "official-executor");
  const approvalManifest = manifests.find((manifest) => manifest.name === "approval-gate");
  const liveGuardManifest = manifests.find((manifest) => manifest.name === "live-guard");
  const idempotencyGateManifest = manifests.find((manifest) => manifest.name === "idempotency-gate");
  const operatorManifest = manifests.find((manifest) => manifest.name === "operator-summarizer");
  if (!executorManifest) {
    throw new Error("No official-executor skill installed");
  }
  if (options.execute && !approvalManifest) {
    throw new Error("No approval-gate skill installed. Write execution requires approval ticket lifecycle.");
  }
  if (!idempotencyGateManifest) {
    throw new Error("No idempotency-gate skill installed. Apply path requires idempotency contract.");
  }
  if (!liveGuardManifest) {
    throw new Error("No live-guard skill installed. Apply path requires live supervised guard contract.");
  }
  if (!operatorManifest) {
    throw new Error("No operator-summarizer skill installed. Apply path requires operator summary contract.");
  }

  const targetPlane = options.plane ?? baseRecord.plane;
  const artifactSnapshot = await loadArtifactSnapshot(runId);
  if (Object.keys(artifactSnapshot).length === 0) {
    throw new Error(
      `Run '${runId}' is missing artifacts.json. This development build only supports current runs. Recreate the plan or archive old run state.`,
    );
  }
  const sharedState: Record<string, unknown> = {};
  const artifacts = createArtifactStore(artifactSnapshot, sharedState);
  const capabilitySnapshot = await inspectOkxEnvironment();
  const proposal = resolveProposal(artifacts, options.proposalName);
  let doctorCheckedAt: string | undefined;
  if (targetPlane === "live" && options.execute) {
    const liveDoctor = await runDoctor({
      probeMode: "active",
      plane: "live",
    });
    doctorCheckedAt = now();
    putArtifact(artifacts, {
      key: "diagnostics.probes",
      version: currentArtifactVersion("diagnostics.probes"),
      producer: "apply-runtime",
      data: {
        probeMode: "active",
        plane: "live",
        probeReceipts: liveDoctor.probeReceipts,
      },
    });
    putArtifact(artifacts, {
      key: "diagnostics.readiness",
      version: currentArtifactVersion("diagnostics.readiness"),
      producer: "apply-runtime",
      data: liveDoctor.diagnosis,
    });
  }
  const decision = await evaluatePolicy({
    phase: "apply",
    artifacts,
    proposal,
    plane: targetPlane,
    approvalProvided: Boolean(options.approve),
    executeRequested: Boolean(options.execute),
    capabilitySnapshot,
  });

  let effectiveDecision: PolicyDecision = decision;
  const syncApplyDecisionArtifacts = (nextDecision: PolicyDecision): void => {
    putArtifact(artifacts, {
      key: "policy.plan-decision",
      version: currentArtifactVersion("policy.plan-decision"),
      producer: "apply-runtime",
      data: nextDecision,
      ruleRefs: nextDecision.ruleRefs ?? [],
      doctrineRefs: nextDecision.doctrineRefs ?? [],
    });
    putArtifact(artifacts, {
      key: "execution.apply-decision",
      version: currentArtifactVersion("execution.apply-decision"),
      producer: "apply-runtime",
      data: nextDecision,
      ruleRefs: nextDecision.ruleRefs ?? [],
      doctrineRefs: nextDecision.doctrineRefs ?? [],
    });
  };
  syncApplyDecisionArtifacts(effectiveDecision);

  const traceWithoutReplay = baseRecord.trace.filter((entry) => entry.skill !== "replay");
  const applyTrace: SkillOutput[] = [...traceWithoutReplay];
  const approvalOutput = approvalManifest
    ? await executeSkill(approvalManifest, {
        runId: baseRecord.id,
        goal: baseRecord.goal,
        plane: targetPlane,
        manifests,
        trace: applyTrace,
        artifacts,
        runtimeInput: {
          selectedProposal: proposal.name,
          executeRequested: Boolean(options.execute),
          approvalProvided: Boolean(options.approve),
          approvedBy: options.approvedBy,
          approvalReason: options.approvalReason ?? "manual_approval",
        },
        sharedState,
      })
    : undefined;
  if (approvalOutput) {
    applyTrace.push(approvalOutput);
  }

  const liveGuardOutput = await executeSkill(liveGuardManifest, {
    runId: baseRecord.id,
    goal: baseRecord.goal,
    plane: targetPlane,
    manifests,
    trace: applyTrace,
    artifacts,
    runtimeInput: {
      executeRequested: Boolean(options.execute),
      approvalProvided: Boolean(options.approve),
      approve: Boolean(options.approve),
      approvedBy: options.approvedBy,
      liveConfirm: options.liveConfirm,
      maxOrderUsd: options.maxOrderUsd,
      maxTotalUsd: options.maxTotalUsd,
      doctorCheckedAt,
      selectedProposal: proposal.name,
    },
    sharedState,
  });
  applyTrace.push(liveGuardOutput);

  const approvalTicket = artifacts.get<ApprovalTicket>("approval.ticket")?.data;
  const liveGuard = artifacts.get<{
    status?: "allowed" | "blocked";
    reasons?: string[];
    nextAction?: string;
  }>("operations.live-guard")?.data;
  const liveGuardReasons = Array.isArray(liveGuard?.reasons)
    ? liveGuard.reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
    : [];
  if (Boolean(options.execute) && (!options.approve || !options.approvedBy || !approvalTicket?.ticketId)) {
    const reasons = [
      ...effectiveDecision.reasons,
      ...(!options.approve ? ["write execution requires --approve"] : []),
      ...(typeof options.approvedBy !== "string" || options.approvedBy.trim().length === 0
        ? ["write execution requires --approved-by <name>"]
        : []),
      ...(!approvalTicket?.ticketId ? ["approval ticket was not issued"] : []),
    ];
    effectiveDecision = {
      ...effectiveDecision,
      outcome: "require_approval",
      reasons: [...new Set(reasons)],
      approvalProvided: false,
    };
    syncApplyDecisionArtifacts(effectiveDecision);
  }
  if (Boolean(options.execute) && liveGuard?.status === "blocked") {
    effectiveDecision = {
      ...effectiveDecision,
      outcome: "blocked",
      reasons: [...new Set([...effectiveDecision.reasons, ...liveGuardReasons])],
      approvalProvided: false,
    };
    syncApplyDecisionArtifacts(effectiveDecision);
  }

  const executorOutput = await executeSkill(executorManifest, {
    runId: baseRecord.id,
    goal: baseRecord.goal,
    plane: targetPlane,
    manifests,
    trace: applyTrace,
    artifacts,
    runtimeInput: {
      selectedProposal: proposal.name,
    },
    sharedState,
  });
  applyTrace.push(executorOutput);

  const idempotencyGateOutput = await executeSkill(idempotencyGateManifest, {
    runId: baseRecord.id,
    goal: baseRecord.goal,
    plane: targetPlane,
    manifests,
    trace: applyTrace,
    artifacts,
    runtimeInput: {
      selectedProposal: proposal.name,
      executeRequested: Boolean(options.execute),
      applyPlane: targetPlane,
    },
    sharedState,
  });
  applyTrace.push(idempotencyGateOutput);
  const idempotencyCheck = artifacts.get<{
    status?: "ok" | "blocked_reconcile_required" | "error";
    nextAction?: string;
    items?: Array<{ ledgerSeq?: number | null }>;
  }>("execution.idempotency-check")?.data;
  if (Boolean(options.execute) && idempotencyCheck?.status === "blocked_reconcile_required") {
    const reason = "idempotency gate requires reconcile before execute.";
    effectiveDecision = {
      ...effectiveDecision,
      outcome: "blocked",
      reasons: [...new Set([...effectiveDecision.reasons, reason])],
      approvalProvided: false,
    };
    syncApplyDecisionArtifacts(effectiveDecision);
  }

  const bundle = extractExecutionBundle(artifacts, proposal);
  const blockedReason = effectiveDecision.outcome === "approved" ? undefined : effectiveDecision.reasons.join("; ");
  const executionOutcome =
    effectiveDecision.outcome === "approved"
      ? await executeApplyWithIdempotency(bundle.intents, {
          runId: baseRecord.id,
          proposal: proposal.name,
          plane: targetPlane,
          executeRequested: Boolean(options.execute),
        })
      : {
          results: bundle.intents.map((intent) =>
            skippedResult(intent, Boolean(options.execute), blockedReason ?? "blocked"),
          ),
          errors: [] as RunErrorRecord[],
          finalResults: bundle.intents.map((intent) =>
            skippedResult(intent, Boolean(options.execute), blockedReason ?? "blocked"),
          ),
        };
  const finalBlockedReason = executionOutcome.blockedByIdempotency ??
    blockedReason ??
    (idempotencyCheck?.status === "blocked_reconcile_required"
      ? "idempotency gate requires reconcile before execute."
      : undefined);
  const executionOk = executionOutcome.finalResults.every((result) => result.ok);
  let status = nextStatusFromPolicy(effectiveDecision.outcome, Boolean(options.execute), executionOk);
  if (executionOutcome.blockedByIdempotency) {
    status = "blocked";
  }
  const hasWriteFailures = executionOutcome.finalResults.some((result) =>
    result.intent.requiresWrite && !result.ok && !result.stderr.includes("idempotent-hit"),
  );
  const reconciliationState: ExecutionRecord["reconciliationState"] = executionOutcome.blockedReconciliationState ??
    (Boolean(options.execute) && hasWriteFailures ? "pending" : "none");
  const idempotencyLedgerSeqFromCheck = Array.isArray(idempotencyCheck?.items)
    ? idempotencyCheck.items
      .map((item) => (typeof item.ledgerSeq === "number" ? item.ledgerSeq : null))
      .filter((value): value is number => value !== null)
      .reduce((max, value) => Math.max(max, value), 0)
    : 0;

  const execution: ExecutionRecord = {
    executionId: `${baseRecord.id}:exec:${baseRecord.executions.length + 1}`,
    requestedAt: now(),
    mode: options.execute ? "execute" : "dry-run",
    plane: targetPlane,
    proposal: proposal.name,
    approvalProvided: Boolean(options.approve),
    approvalTicketId: approvalTicket?.ticketId,
    idempotencyChecked: executionOutcome.idempotencyChecked === true,
    idempotencyLedgerSeq: executionOutcome.idempotencyLedgerSeq ?? (idempotencyLedgerSeqFromCheck > 0 ? idempotencyLedgerSeqFromCheck : undefined),
    reconciliationRequired: reconciliationState === "pending" || reconciliationState === "ambiguous",
    reconciliationState,
    doctorCheckedAt,
    status,
    results: executionOutcome.results,
    blockedReason: finalBlockedReason,
  };

  const nextActionForOperator = executionOutcome.nextSafeAction ??
    (idempotencyCheck?.status === "blocked_reconcile_required"
      ? (idempotencyCheck.nextAction ?? `node dist/bin/trademesh.js reconcile ${baseRecord.id}`)
      : finalBlockedReason?.toLowerCase().includes("reconcile")
        ? `node dist/bin/trademesh.js reconcile ${baseRecord.id}`
        : `node dist/bin/trademesh.js export ${baseRecord.id}`);
  const operatorOutput = await executeSkill(operatorManifest, {
    runId: baseRecord.id,
    goal: baseRecord.goal,
    plane: targetPlane,
    manifests,
    trace: applyTrace,
    artifacts,
    runtimeInput: {
      runStatus: status,
      latestExecution: execution,
      nextSafeAction: nextActionForOperator,
    },
    sharedState,
  });
  applyTrace.push(operatorOutput);
  const operatorSummary = artifacts.get<OperatorSummaryV3>("report.operator-summary")?.data;

  const nextRecord = hydrateRecord({
    ...baseRecord,
    plane: targetPlane,
    status,
    selectedProposal: proposal.name,
    policyDecision: effectiveDecision,
    trace: applyTrace,
    capabilitySnapshot,
    executions: [...baseRecord.executions, execution],
    errors: [...baseRecord.errors, ...executionOutcome.errors],
    operatorState: operatorSummary
      ? operatorSummary.requiresHumanAction
        ? operatorSummary.blockers.length > 0 ? "blocked" : "attention"
        : "stable"
      : undefined,
    lastSafeAction: operatorSummary?.nextSafeAction,
    requiresHumanAction: operatorSummary?.requiresHumanAction,
    notes: [
      ...baseRecord.notes,
      `Apply ${status}: ${effectiveDecision.reasons.join(" | ")}`,
      ...(executionOutcome.idempotentHitCount && executionOutcome.idempotentHitCount > 0
        ? [`Idempotent hits: ${executionOutcome.idempotentHitCount}`]
        : []),
      ...(liveGuard?.status === "blocked" ? [`Live guard blocked: ${liveGuardReasons.join(" | ")}`] : []),
      ...(executionOutcome.nextSafeAction ? [`Next safe action: ${executionOutcome.nextSafeAction}`] : []),
      ...(executionOutcome.errors.length > 0 ? [`Execution errors recorded: ${executionOutcome.errors.length}`] : []),
    ],
    updatedAt: now(),
  });

  await saveRun(nextRecord);
  await saveArtifactSnapshot(runId, artifacts.snapshot());
  return nextRecord;
}

export async function retryRun(runId: string): Promise<RunRecord> {
  const record = await loadNormalizedRun(runId);
  const latestFailedExecution = [...record.executions].reverse().find((execution) => execution.status === "failed" || execution.results.some((result) => !result.ok));
  if (!latestFailedExecution || latestFailedExecution.mode !== "execute") {
    throw new Error(`Run ${runId} has no failed execution to retry.`);
  }

  const retryableIntents = latestFailedExecution.results
    .filter((result) => !result.ok && !result.skipped && result.intent.safeToRetry)
    .map((result) => result.intent);
  if (retryableIntents.length === 0) {
    throw new Error(`Run ${runId} has no safe retry intents; retry only replays failed read-path intents.`);
  }

  const executionOutcome = await executeWithRecovery(retryableIntents, {
    runId: record.id,
    proposal: latestFailedExecution.proposal,
    executeRequested: true,
  });
  const executionOk = executionOutcome.finalResults.every((result) => result.ok);
  const status: RunStatus = executionOk ? "executed" : "failed";
  const retryExecution: ExecutionRecord = {
    requestedAt: now(),
    mode: "execute",
    plane: latestFailedExecution.plane,
    proposal: latestFailedExecution.proposal,
    approvalProvided: latestFailedExecution.approvalProvided,
    status,
    results: executionOutcome.results,
    blockedReason: executionOk ? undefined : "Retry execution still contains failed safe-to-retry intents.",
  };

  const nextRecord = hydrateRecord({
    ...record,
    status,
    executions: [...record.executions, retryExecution],
    errors: [...record.errors, ...executionOutcome.errors],
    notes: [
      ...record.notes,
      `Retry ${status}: replayed ${retryableIntents.length} safe-to-retry intent(s).`,
    ],
    updatedAt: now(),
  });

  await saveRun(nextRecord);
  return nextRecord;
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

function orderTimestampMs(order: Record<string, unknown>): number | null {
  const value = toFiniteNumber(order.cTime) ?? toFiniteNumber(order.uTime) ?? toFiniteNumber(order.ts);
  if (value === null) {
    return null;
  }
  if (value > 10_000_000_000) {
    return value;
  }
  return value * 1_000;
}

async function reconcileWriteIntent(
  intent: OkxCommandIntent,
  plane: ExecutionPlane,
): Promise<{
  status: ReconciliationItem["status"];
  remoteOrderId?: string;
  reason: string;
  evidence: string[];
}> {
  const evidence: string[] = [];
  const clientOrderRef = deriveClientOrderRef(intent);
  if (clientOrderRef) {
    const byClient = runOkxJson<unknown>(["trade", "orders-history", "--clOrdId", clientOrderRef], plane);
    evidence.push(`client-order-id query: ${byClient.command}`);
    if (byClient.ok) {
      const rows = orderRows(byClient.data);
      if (rows.length === 1) {
        const ordId = rows[0].ordId;
        return {
          status: "matched",
          remoteOrderId: typeof ordId === "string" ? ordId : undefined,
          reason: "Matched by clientOrderRef.",
          evidence,
        };
      }
      if (rows.length > 1) {
        return {
          status: "ambiguous",
          reason: "Multiple remote orders matched the same clientOrderRef.",
          evidence,
        };
      }
    } else {
      evidence.push(`client-order-id query failed: ${byClient.reason ?? "unknown error"}`);
    }
  } else {
    evidence.push("clientOrderRef missing; fallback matching required.");
  }

  const instId = readIntentFlag(intent, "instId");
  const side = (readIntentFlag(intent, "side") ?? "").toLowerCase();
  const sz = toFiniteNumber(readIntentFlag(intent, "sz"));
  if (!instId) {
    return {
      status: "failed",
      reason: "Intent missing --instId; fallback reconciliation is unavailable.",
      evidence,
    };
  }

  const fallback = runOkxJson<unknown>(["trade", "orders-history", "--instId", instId], plane);
  evidence.push(`fallback query: ${fallback.command}`);
  if (!fallback.ok) {
    return {
      status: "failed",
      reason: `Fallback query failed: ${fallback.reason ?? "unknown error"}`,
      evidence,
    };
  }

  const nowMs = Date.now();
  const windowMs = 2 * 60 * 60 * 1_000;
  const candidates = orderRows(fallback.data).filter((row) => {
    const rowSide = typeof row.side === "string" ? row.side.toLowerCase() : "";
    if (side && rowSide && rowSide !== side) {
      return false;
    }
    const rowSz = toFiniteNumber(row.sz);
    if (sz !== null && rowSz !== null && Math.abs(rowSz - sz) > 1e-8) {
      return false;
    }
    const ts = orderTimestampMs(row);
    if (ts !== null && Math.abs(nowMs - ts) > windowMs) {
      return false;
    }
    return true;
  });

  if (candidates.length === 1) {
    const ordId = candidates[0].ordId;
    return {
      status: "matched",
      remoteOrderId: typeof ordId === "string" ? ordId : undefined,
      reason: "Matched by fallback fields (instId+side+size+time-window).",
      evidence,
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      reason: "Fallback matching returned multiple candidates.",
      evidence,
    };
  }
  return {
    status: "failed",
    reason: "No remote order matched by client-order-id or fallback fields.",
    evidence,
  };
}

export async function reconcileRun(runId: string, options: ReconcileOptions = {}): Promise<RunRecord> {
  const record = await loadNormalizedRun(runId);
  const manifests = await loadSkillRegistry();
  const reconcileManifest = manifests.find((manifest) => manifest.name === "reconcile-engine");
  const operatorManifest = manifests.find((manifest) => manifest.name === "operator-summarizer");
  if (!reconcileManifest) {
    throw new Error("No reconcile-engine skill installed");
  }
  if (!operatorManifest) {
    throw new Error("No operator-summarizer skill installed");
  }
  const latestExecution = record.executions.at(-1);
  if (!latestExecution || latestExecution.mode !== "execute") {
    throw new Error(`Run ${runId} has no execute receipt to reconcile.`);
  }

  const artifactSnapshot = await loadArtifactSnapshot(runId);
  const sharedState: Record<string, unknown> = {};
  const artifacts = createArtifactStore(artifactSnapshot, sharedState);
  const traceWithoutReplay = record.trace.filter((entry) => entry.skill !== "replay");
  const reconcileOutput = await executeSkill(reconcileManifest, {
    runId: record.id,
    goal: record.goal,
    plane: latestExecution.plane,
    manifests,
    trace: traceWithoutReplay,
    artifacts,
    runtimeInput: {
      execution: latestExecution,
      reconcileSource: options.source ?? "auto",
      reconcileWindowMin: options.windowMin ?? 120,
    },
    sharedState,
  });
  const report = artifacts.get<ReconciliationReport>("execution.reconciliation")?.data;
  if (!report) {
    throw new Error("Reconcile engine did not produce execution.reconciliation artifact.");
  }

  const reconciledExecutions = [...record.executions];
  reconciledExecutions[reconciledExecutions.length - 1] = {
    ...latestExecution,
    reconciliationState: report.status,
    reconciliationRequired: report.status !== "matched",
  };
  const nextStatus: RunStatus = report.status === "matched" && record.status === "blocked" ? "executed" : record.status;
  const operatorOutput = await executeSkill(operatorManifest, {
    runId: record.id,
    goal: record.goal,
    plane: latestExecution.plane,
    manifests,
    trace: [...traceWithoutReplay, reconcileOutput],
    artifacts,
    runtimeInput: {
      runStatus: nextStatus,
      latestExecution: reconciledExecutions.at(-1),
      nextSafeAction: report.status === "matched"
        ? `node dist/bin/trademesh.js export ${record.id}`
        : `node dist/bin/trademesh.js reconcile ${record.id}`,
    },
    sharedState,
  });
  const operatorSummary = artifacts.get<OperatorSummaryV3>("report.operator-summary")?.data;
  const nextRecord = hydrateRecord({
    ...record,
    status: nextStatus,
    trace: [...traceWithoutReplay, reconcileOutput, operatorOutput],
    executions: reconciledExecutions,
    operatorState: operatorSummary
      ? operatorSummary.requiresHumanAction
        ? operatorSummary.blockers.length > 0 ? "blocked" : "attention"
        : "stable"
      : record.operatorState,
    lastSafeAction: operatorSummary?.nextSafeAction ?? record.lastSafeAction,
    requiresHumanAction: operatorSummary?.requiresHumanAction ?? record.requiresHumanAction,
    notes: [
      ...record.notes,
      `Reconcile ${report.status}: ${report.items.length} write intent(s) processed.`,
    ],
    updatedAt: now(),
  });

  await saveRun(nextRecord);
  await saveArtifactSnapshot(runId, artifacts.snapshot());
  return nextRecord;
}

export async function replayRun(runId: string, options: ReplayOptions = {}): Promise<RunRecord> {
  const record = await loadNormalizedRun(runId);
  const manifests = await loadSkillRegistry();
  const replayManifest = manifests.find((manifest) => manifest.name === "replay");
  const operatorManifest = manifests.find((manifest) => manifest.name === "operator-summarizer");
  if (!replayManifest) {
    return record;
  }

  const sharedState: Record<string, unknown> = {};
  const artifacts = createArtifactStore(await loadArtifactSnapshot(runId), sharedState);
  const traceWithoutReplay = record.trace.filter((entry) => entry.skill !== "replay");
  const replayOutput = await executeSkill(replayManifest, {
    runId: record.id,
    goal: record.goal,
    plane: record.plane,
    manifests,
    trace: traceWithoutReplay,
    artifacts,
    runtimeInput: {
      skillFilter: options.skill,
      latestExecutionResults: record.executions.at(-1)?.results ?? [],
    },
    sharedState,
  });
  const replayTrace = [...traceWithoutReplay, replayOutput];
  let operatorOutput: SkillOutput | undefined;
  if (operatorManifest) {
    operatorOutput = await executeSkill(operatorManifest, {
      runId: record.id,
      goal: record.goal,
      plane: record.plane,
      manifests,
      trace: replayTrace,
      artifacts,
      runtimeInput: {
        runStatus: record.status,
        latestExecution: record.executions.at(-1),
        nextSafeAction: `node dist/bin/trademesh.js export ${record.id}`,
      },
      sharedState,
    });
  }
  const nextTrace = operatorOutput ? [...replayTrace, operatorOutput] : replayTrace;
  const operatorSummary = artifacts.get<OperatorSummaryV3>("report.operator-summary")?.data;
  const nextRecord = hydrateRecord({
    ...record,
    trace: nextTrace,
    operatorState: operatorSummary
      ? operatorSummary.requiresHumanAction
        ? operatorSummary.blockers.length > 0 ? "blocked" : "attention"
        : "stable"
      : record.operatorState,
    lastSafeAction: operatorSummary?.nextSafeAction ?? record.lastSafeAction,
    requiresHumanAction: operatorSummary?.requiresHumanAction ?? record.requiresHumanAction,
    updatedAt: now(),
  });

  await saveRun(nextRecord);
  await saveArtifactSnapshot(runId, artifacts.snapshot());
  return nextRecord;
}

export async function rehearseDemo(options: RehearseOptions = {}): Promise<RunRecord> {
  const manifests = await loadSkillRegistry();
  const runId = await createRunId();
  const capabilitySnapshot = await inspectOkxEnvironment();
  if (!capabilitySnapshot.demoProfileLikelyConfigured) {
    throw new Error("Demo profile is required for rehearsal. Run `trademesh doctor --probe active` first.");
  }

  const sharedState: Record<string, unknown> = {};
  const artifacts = createArtifactStore(undefined, sharedState);
  const route = [
    "env-probe",
    "market-probe",
    "account-probe",
    "diagnosis-synthesizer",
    "rehearsal-planner",
    "policy-gate",
    "official-executor",
  ];
  const graph = await runExplicitRoute({
    route,
    manifests,
    executeSkill,
    context: {
      runId,
      goal: "rehearse demo write path",
      plane: "demo",
      manifests,
      trace: [],
      artifacts,
      runtimeInput: {
        capabilitySnapshot,
        probeMode: "write",
        goalOverrides: {
          symbols: ["BTC"],
          targetDrawdownPct: 2,
          hedgeIntent: "protect_downside",
          timeHorizon: "intraday",
          executePreference: options.execute ? "execute" : "dry_run",
        },
      },
      sharedState,
    },
  });

  const proposal = resolveProposal(artifacts, undefined);
  const decision = await evaluatePolicy({
    phase: "apply",
    artifacts,
    proposal,
    plane: "demo",
    approvalProvided: Boolean(options.approve),
    executeRequested: Boolean(options.execute),
    capabilitySnapshot,
  });
  putArtifact(artifacts, {
    key: "policy.plan-decision",
    version: currentArtifactVersion("policy.plan-decision"),
    producer: "rehearse-runtime",
    data: decision,
    ruleRefs: decision.ruleRefs ?? [],
    doctrineRefs: decision.doctrineRefs ?? [],
  });
  putArtifact(artifacts, {
    key: "execution.apply-decision",
    version: currentArtifactVersion("execution.apply-decision"),
    producer: "rehearse-runtime",
    data: decision,
    ruleRefs: decision.ruleRefs ?? [],
    doctrineRefs: decision.doctrineRefs ?? [],
  });
  const bundle = extractExecutionBundle(artifacts, proposal);
  const blockedReason = decision.outcome === "approved" ? undefined : decision.reasons.join("; ");
  const executionOutcome =
    decision.outcome === "approved"
      ? await executeWithRecovery(bundle.intents, {
          runId,
          proposal: proposal.name,
          executeRequested: Boolean(options.execute),
        })
      : {
          results: bundle.intents.map((intent) =>
            skippedResult(intent, Boolean(options.execute), blockedReason ?? "blocked"),
          ),
          errors: [] as RunErrorRecord[],
          finalResults: bundle.intents.map((intent) =>
            skippedResult(intent, Boolean(options.execute), blockedReason ?? "blocked"),
          ),
        };
  const executionOk = executionOutcome.finalResults.every((result) => result.ok);
  const status = nextStatusFromPolicy(decision.outcome, Boolean(options.execute), executionOk);
  const execution: ExecutionRecord = {
    requestedAt: now(),
    mode: options.execute ? "execute" : "dry-run",
    plane: "demo",
    proposal: proposal.name,
    approvalProvided: Boolean(options.approve),
    status,
    results: executionOutcome.results,
    blockedReason,
  };
  putArtifact(artifacts, {
    key: "operations.rehearsal-receipt",
    version: currentArtifactVersion("operations.rehearsal-receipt"),
    producer: "rehearse-runtime",
    data: {
      runId,
      proposal: proposal.name,
      status,
      mode: execution.mode,
      blockedReason: blockedReason ?? null,
      results: execution.results,
      decision,
    },
    ruleRefs: decision.ruleRefs ?? [],
    doctrineRefs: decision.doctrineRefs ?? [],
  });

  const record = hydrateRecord({
    kind: "trademesh-run",
    version: 3,
    id: runId,
    goal: "rehearse demo write path",
    plane: "demo",
    status,
    routeKind: "operations",
    route: graph.route,
    trace: graph.trace,
    selectedProposal: proposal.name,
    policyDecision: decision,
    capabilitySnapshot,
    routeSummary: buildRouteSummary("rehearse demo write path", manifests, graph.route),
    executions: [execution],
    errors: executionOutcome.errors,
    notes: [
      "Demo rehearsal route executed.",
      `Apply verdict: ${decision.outcome}`,
      `Execute requested: ${options.execute ? "yes" : "no"}`,
    ],
    createdAt: now(),
    updatedAt: now(),
  });

  await saveRun(record);
  await saveArtifactSnapshot(runId, artifacts.snapshot());
  return record;
}

interface RunListSummary {
  createdAt: string;
  updatedAt: string;
  goal: string;
  status: string;
  plane: string;
  route: string[];
  selectedProposal?: string;
  exported: boolean;
}

function safeRunListSummary(raw: unknown): RunListSummary {
  if (!raw || typeof raw !== "object") {
    return {
      createdAt: "",
      updatedAt: "",
      goal: "(invalid run record)",
      status: "unknown",
      plane: "unknown",
      route: [],
      exported: false,
    };
  }

  const record = raw as Partial<RunRecord>;
  return {
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    goal: typeof record.goal === "string" ? record.goal : "(missing goal)",
    status: typeof record.status === "string" ? record.status : "unknown",
    plane: typeof record.plane === "string" ? record.plane : "unknown",
    route: Array.isArray(record.route) ? record.route.filter((entry): entry is string => typeof entry === "string") : [],
    selectedProposal: typeof record.selectedProposal === "string" ? record.selectedProposal : undefined,
    exported: typeof record.id === "string" ? hasExportBundle(record.id) : false,
  };
}

function truncate(value: string, max = 48): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(
      header.length,
      ...rows.map((row) => (row[column] ?? "").length),
    ),
  );
  const render = (cells: string[]) =>
    cells.map((cell, index) => (cell ?? "").padEnd(widths[index])).join(" | ");

  return [render(headers), widths.map((width) => "-".repeat(width)).join("-+-"), ...rows.map(render)].join("\n");
}

function block(title: string, lines: string[]): string {
  return [`== ${title} ==`, ...lines, ""].join("\n");
}

function header(title: string, record: RunRecord): string[] {
  return [
    "TradeMesh CLI Skill Mesh 2.0",
    title,
    `Run: ${record.id}`,
    `Plane: ${record.plane} | Status: ${record.status} | Goal: ${record.goal}`,
    record.judgeSummary?.headline ?? "",
    "",
  ].filter(Boolean);
}

function formatExecutionResult(result: ExecutionResult): string {
  if (result.skipped && result.dryRun) {
    return `[preview] ${result.intent.intentId} | module=${result.intent.module} write=${result.intent.requiresWrite ? "yes" : "no"} retry=${result.intent.safeToRetry ? "yes" : "no"} | ${result.intent.command}`;
  }
  if (result.skipped) {
    return `[skip] ${result.intent.intentId} | module=${result.intent.module} retry=${result.intent.safeToRetry ? "yes" : "no"} | ${result.intent.command}`;
  }
  if (result.ok) {
    return `[ok] ${result.intent.intentId} | ${result.durationMs}ms | ${result.intent.command}`;
  }
  return `[fail] ${result.intent.intentId} | ${result.durationMs}ms | ${result.intent.command}`;
}

function traceGoalIntake(record: RunRecord): GoalIntake | null {
  const candidate = latestTraceEntry(record.trace, "portfolio-xray")?.metadata?.goalIntake;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  return candidate as GoalIntake;
}

function traceFacts(record: RunRecord, skillName: string, limit = 3): string[] {
  return (latestTraceEntry(record.trace, skillName)?.facts ?? []).slice(0, limit);
}

function capabilityLines(record: RunRecord): string[] {
  return [
    `Readiness grade: ${record.capabilitySnapshot.readinessGrade}`,
    `Recommended plane: ${record.capabilitySnapshot.recommendedPlane}`,
    `OKX CLI: ${record.capabilitySnapshot.okxCliAvailable ? "detected" : "missing"}`,
    `Profiles: demo=${record.capabilitySnapshot.demoProfileLikelyConfigured ? "ready" : "missing"} live=${record.capabilitySnapshot.liveProfileLikelyConfigured ? "ready" : "missing"}`,
    `Blockers: ${record.capabilitySnapshot.blockers.length > 0 ? record.capabilitySnapshot.blockers.join(" | ") : "none"}`,
  ];
}

function proposalLines(record: RunRecord): string[] {
  if (record.proposals.length === 0) {
    return ["No proposals were produced."];
  }

  return record.proposals.map((proposal, index) => {
    const score = proposal.scoreBreakdown;
    const marker = proposal.recommended ? "[recommended]" : `[#${index + 1}]`;
    const scoreText = score
      ? `score=${score.total} protect=${score.protection} cost=${score.cost} exec=${score.executionRisk} policy=${score.policyFit} data=${score.dataConfidence}`
      : "score=n/a";
    const readiness = proposal.executionReadiness ?? "unknown";
    const why = proposal.recommended
      ? proposal.reason
      : proposal.rejectionReason ?? proposal.reason;
    return `${marker} ${proposal.name} | ${scoreText} | readiness=${readiness} actionable=${proposal.actionable ? "yes" : "no"} | ${truncate(why, 120)}`;
  });
}

function actionabilityLines(record: RunRecord): string[] {
  if (record.proposals.length === 0) {
    return ["No actionability data is available."];
  }

  return record.proposals.map((proposal) => {
    const topGap = proposal.capabilityGaps?.[0];
    const topGapText = topGap ? `[${topGap.severity}] ${topGap.message}` : "none";
    return `${proposal.name}: ${proposal.executionReadiness ?? "unknown"} | gap=${topGapText}`;
  });
}

function goalIntakeLines(record: RunRecord): string[] {
  const intake = traceGoalIntake(record);
  if (!intake) {
    return ["Goal intake was not captured on this run."];
  }

  return [
    `Symbols: ${intake.symbols.join(", ")}`,
    `Drawdown target: ${formatDrawdownPct(intake.targetDrawdownPct)}`,
    `Intent: ${intake.hedgeIntent}`,
    `Horizon: ${intake.timeHorizon}`,
    `Execute preference: ${intake.executePreference}`,
    `Warnings: ${intake.warnings.length > 0 ? intake.warnings.join(" | ") : "none"}`,
  ];
}

function policyLines(record: RunRecord): string[] {
  const policy = record.policyDecision;
  if (!policy) {
    return ["No policy decision recorded yet."];
  }

  return [
    `Verdict: ${policy.outcome}`,
    `Reasons: ${policy.reasons.join(" | ") || "none"}`,
    `Capability gaps: ${policy.capabilityGaps && policy.capabilityGaps.length > 0 ? policy.capabilityGaps.map((gap) => `[${gap.severity}] ${gap.message}`).join(" | ") : "none"}`,
  ];
}

function latestApprovalTicket(artifacts: ArtifactStore): ApprovalTicket | null {
  return artifacts.get<ApprovalTicket>("approval.ticket")?.data ?? null;
}

function latestReconciliation(artifacts: ArtifactStore): ReconciliationReport | null {
  return artifacts.get<ReconciliationReport>("execution.reconciliation")?.data ?? null;
}

function idempotentHitCount(execution: ExecutionRecord | undefined): number {
  if (!execution) {
    return 0;
  }
  return execution.results.filter((result) => result.stderr.includes("skipped(idempotent-hit)")).length;
}

function operatorNextAction(record: RunRecord, artifacts: ArtifactStore): string {
  const latestExecution = record.executions.at(-1);
  if (latestExecution?.status === "approval_required") {
    return `node dist/bin/trademesh.js apply ${record.id} --plane ${record.plane} --proposal ${latestExecution.proposal} --approve --approved-by <name> --execute`;
  }

  if (latestExecution?.blockedReason?.toLowerCase().includes("reconcile")) {
    return `node dist/bin/trademesh.js reconcile ${record.id}`;
  }

  const reconciliation = latestReconciliation(artifacts);
  if (reconciliation && reconciliation.status !== "matched") {
    return `node dist/bin/trademesh.js reconcile ${record.id}`;
  }

  if (!latestExecution) {
    const selectedProposal = record.selectedProposal ?? preferredProposalName(record.proposals) ?? "<proposal>";
    return `node dist/bin/trademesh.js apply ${record.id} --plane demo --proposal ${selectedProposal} --approve --approved-by <name> --execute`;
  }

  return `node dist/bin/trademesh.js export ${record.id}`;
}

function buildOperatorSummary(record: RunRecord, artifacts: ArtifactStore): OperatorSummaryV3 {
  const latestExecution = record.executions.at(-1) ?? null;
  const approvalTicket = latestApprovalTicket(artifacts);
  const reconciliation = latestReconciliation(artifacts);
  const blockers: string[] = [];
  if (record.status === "blocked") {
    blockers.push("policy_blocked");
  }
  if (record.status === "approval_required") {
    blockers.push("approval_required");
  }
  if (latestExecution?.blockedReason && latestExecution.blockedReason.trim().length > 0) {
    blockers.push(latestExecution.blockedReason);
  }
  if (reconciliation && reconciliation.status !== "matched") {
    blockers.push(`reconciliation_${reconciliation.status}`);
  }
  const reconciliationState = latestExecution?.reconciliationState ?? reconciliation?.status ?? "none";
  const requiresHumanAction =
    blockers.length > 0 ||
    record.status === "approval_required" ||
    reconciliationState === "pending" ||
    reconciliationState === "ambiguous" ||
    reconciliationState === "failed";
  const canExecuteNow =
    !requiresHumanAction &&
    (record.status === "ready" ||
      (record.status === "dry_run" && record.policyDecision?.outcome === "approved" && blockers.length === 0));
  return {
    runId: record.id,
    plane: record.plane,
    status: record.status,
    isExecutable: canExecuteNow,
    blockers,
    approval: {
      provided: latestExecution?.approvalProvided ?? false,
      ticketId: approvalTicket?.ticketId ?? latestExecution?.approvalTicketId ?? null,
      approvedBy: approvalTicket?.approvedBy ?? null,
      reason: approvalTicket?.reason ?? null,
    },
    idempotency: {
      checked: latestExecution?.idempotencyChecked ?? false,
      hitCount: idempotentHitCount(latestExecution ?? undefined),
      ledgerSeq: latestExecution?.idempotencyLedgerSeq ?? null,
    },
    reconciliation: {
      state: reconciliationState,
      required: reconciliationState === "pending" || reconciliationState === "ambiguous" || reconciliationState === "failed",
    },
    nextSafeAction: operatorNextAction(record, artifacts),
    requiresHumanAction,
    generatedAt: now(),
  };
}

function putOperatorSummaryArtifact(
  artifacts: ArtifactStore,
  record: RunRecord,
  producer: string,
): OperatorSummaryV3 {
  const summary = buildOperatorSummary(record, artifacts);
  putArtifact(artifacts, {
    key: "report.operator-summary",
    version: currentArtifactVersion("report.operator-summary"),
    producer,
    data: summary,
  });
  return summary;
}

function nextSafeAction(record: RunRecord): string[] {
  if (record.executions.length > 0) {
    return [
      `Replay: node dist/bin/trademesh.js replay ${record.id}`,
      `Reconcile: node dist/bin/trademesh.js reconcile ${record.id}`,
      `Export: node dist/bin/trademesh.js export ${record.id}`,
      `Retry: node dist/bin/trademesh.js retry ${record.id}`,
    ];
  }

  const selectedProposal = record.selectedProposal ?? preferredProposalName(record.proposals);
  return [
    `Preview apply: node dist/bin/trademesh.js apply ${record.id} --plane ${record.plane} --proposal ${selectedProposal ?? "<proposal>"} --approve`,
    `Execute on demo: node dist/bin/trademesh.js apply ${record.id} --plane demo --proposal ${selectedProposal ?? "<proposal>"} --approve --approved-by <name> --execute`,
  ];
}

function formatPlanSummary(record: RunRecord): string {
  return [
    ...header("Plan Review", record),
    block("Route Selected", [
      `Route: ${record.route.join(" -> ")}`,
      ...(record.routeSummary?.reasons.length ? record.routeSummary.reasons : ["No route reasoning captured."]),
    ]),
    block("Capabilities Detected", capabilityLines(record)),
    block("Goal Interpretation", goalIntakeLines(record)),
    block("Portfolio + Market Summary", [
      ...traceFacts(record, "portfolio-xray"),
      ...traceFacts(record, "market-scan"),
      ...traceFacts(record, "trade-thesis"),
    ]),
    block("Proposal Ranking", proposalLines(record)),
    block("Actionability Summary", actionabilityLines(record)),
    block("Policy Preview", policyLines(record)),
    block("Next Safe Action", nextSafeAction(record)),
  ].join("\n");
}

function formatApplySummary(record: RunRecord): string {
  const latestExecution = record.executions.at(-1);
  const commands = latestExecution?.results.map(formatExecutionResult).slice(0, 8) ?? [];
  const idempotentHits = idempotentHitCount(latestExecution);

  return [
    ...header("Apply Receipt", record),
    block("Selected Proposal", [
      `Proposal: ${latestExecution?.proposal ?? record.selectedProposal ?? "n/a"}`,
      `Mode: ${latestExecution?.mode ?? "n/a"}`,
      `Approval provided: ${latestExecution?.approvalProvided ? "yes" : "no"}`,
      `Approval ticket: ${latestExecution?.approvalTicketId ?? "none"}`,
    ]),
    block("Policy Verdict", policyLines(record)),
    block("Command Preview / Execution", commands.length > 0 ? commands : ["No command preview recorded."]),
    block("Safety Guard Summary", [
      `Execution status: ${latestExecution?.status ?? "n/a"}`,
      `Blocked reason: ${latestExecution?.blockedReason ?? "none"}`,
      `Idempotency checked: ${latestExecution?.idempotencyChecked ? "yes" : "no"}`,
      `Idempotent hits: ${idempotentHits}`,
      `Reconciliation state: ${latestExecution?.reconciliationState ?? "none"}`,
      `Errors logged: ${record.errors.length}`,
    ]),
    block("Replay Pointer", [
      `Replay: node dist/bin/trademesh.js replay ${record.id}`,
      `Reconcile: node dist/bin/trademesh.js reconcile ${record.id}`,
      `Export: node dist/bin/trademesh.js export ${record.id}`,
      `Runs list: node dist/bin/trademesh.js runs list`,
    ]),
  ].join("\n");
}

export async function listRuns(): Promise<{ runs: RunListSummary[]; summary: string }> {
  const runIds = await listRunIds();
  const runs = (
    await Promise.all(
      runIds.map(async (runId) => {
        try {
          const record = await loadRun(runId);
          return safeRunListSummary(record);
        } catch {
          return null;
        }
      }),
    )
  )
    .filter((entry): entry is RunListSummary => Boolean(entry))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const summary = [
    "TradeMesh Runs",
    table(
      ["Updated", "Plane", "Status", "Exported", "Route", "Proposal", "Goal"],
      runs.map((run) => [
        run.updatedAt || run.createdAt || "n/a",
        run.plane,
        run.status,
        run.exported ? "yes" : "no",
        truncate(run.route.join(" -> "), 32),
        run.selectedProposal ?? "n/a",
        truncate(run.goal, 44),
      ]),
    ),
  ].join("\n\n");

  return {
    runs,
    summary,
  };
}

export async function printSkillList(): Promise<{ manifests: SkillManifest[]; summary: string }> {
  const manifests = await loadSkillRegistry();
  const summary = [
    "TradeMesh Installed Skills",
    table(
      ["Skill", "Stage", "Role", "Mode", "Writes", "Description"],
      manifests.map((manifest) => [
        manifest.name,
        manifest.stage,
        manifest.role,
        manifest.alwaysOn ? "always-on" : "on-demand",
        manifest.writes ? "yes" : "no",
        truncate(manifest.description, 48),
      ]),
    ),
  ].join("\n\n");

  return {
    manifests,
    summary,
  };
}

export async function inspectSkill(skillName: string): Promise<{ skill: SkillRuntimeSurface; summary: string }> {
  const manifests = await loadSkillRegistry();
  const skill = inspectSkillSurface(manifests, skillName);
  if (!skill) {
    throw new Error(`Skill '${skillName}' was not found in the local registry.`);
  }

  const summary = [
    "TradeMesh Skill Inspect",
    `Skill: ${skill.name}`,
    "",
    block("Manifest", [
      `Stage: ${skill.stage}`,
      `Role: ${skill.role}`,
      `Writes: ${skill.writes ? "yes" : "no"}`,
      `Risk level: ${skill.riskLevel}`,
      `Description: ${skill.description}`,
    ]),
    block("Contracts", [
      `Consumes: ${skill.consumes.length > 0 ? skill.consumes.join(", ") : "none"}`,
      `Produces: ${skill.produces.length > 0 ? skill.produces.join(", ") : "none"}`,
      `Preferred handoffs: ${skill.preferredHandoffs.length > 0 ? skill.preferredHandoffs.join(", ") : "none"}`,
      `Allowed execution modules: ${skill.allowedExecutionModules.length > 0 ? skill.allowedExecutionModules.join(", ") : "none"}`,
      `Standalone command: ${skill.standaloneCommand}`,
      `Standalone route: ${skill.standaloneRoute.length > 0 ? skill.standaloneRoute.join(" -> ") : "none"}`,
      `Standalone inputs: ${skill.standaloneInputs.length > 0 ? skill.standaloneInputs.join(", ") : "none"}`,
      `Standalone outputs: ${skill.standaloneOutputs.length > 0 ? skill.standaloneOutputs.join(", ") : "none"}`,
      `Required capabilities: ${skill.requiredCapabilities.length > 0 ? skill.requiredCapabilities.join(", ") : "none"}`,
    ]),
    block("Routing Signals", [
      `Requires: ${skill.requires.length > 0 ? skill.requires.join(", ") : "none"}`,
      `Triggers: ${skill.triggers.length > 0 ? skill.triggers.join(", ") : "none"}`,
    ]),
  ].join("\n");

  return { skill, summary };
}

export async function describeSkillGraph(): Promise<{ graph: SkillGraphView; summary: string }> {
  const manifests = await loadSkillRegistry();
  const graph = buildSkillGraphView(manifests);
  const summary = [
    "TradeMesh Skill Mesh Graph",
    `Flagship route: ${graph.flagshipRoute.join(" -> ") || "n/a"}`,
    "",
    block("Nodes", graph.nodes.map((node) =>
      `${node.name} [${node.stage}/${node.role}] writes=${node.writes ? "yes" : "no"} consumes=${node.consumes.length} produces=${node.produces.length}`,
    )),
    block("Edges", graph.edges.map((edge) => `${edge.from} -> ${edge.to} (${edge.kind}: ${edge.label})`)),
  ].join("\n");

  return {
    graph,
    summary,
  };
}

export async function runDemo(goal: string, options: DemoOptions): Promise<DemoSession> {
  const doctor = await runDoctor();
  const graph = await describeSkillGraph();
  const planned = await createPlan(goal, {
    plane: options.plane,
    goalOverrides: options.goalOverrides,
  });
  const applied = await applyRun(planned.id, {
    plane: options.plane,
    proposalName: planned.selectedProposal,
    approve: true,
    approvedBy: "demo-session",
    approvalReason: "demo_session",
    execute: Boolean(options.execute),
  });
  const replayed = await replayRun(planned.id);

  const summary = [
    "TradeMesh CLI Skill Mesh 2.0 Demo",
    `Goal: ${goal}`,
    "",
    doctor.summary,
    graph.summary,
    formatRunSummary(planned),
    formatRunSummary(applied),
    formatReplay(replayed),
  ].join("\n\n");

  return {
    doctor,
    graph: graph.graph,
    planned,
    applied,
    replayed,
    summary,
  };
}

function markdownSection(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines, ""].join("\n");
}

function exportBundlePayload(record: RunRecord, artifacts: ArtifactStore): Record<string, unknown> {
  const goalIntake = goalIntakeFromArtifacts(artifacts) ?? traceGoalIntake(record);
  const diagnosis = artifacts.get<EnvironmentDiagnosis>("diagnostics.readiness")?.data ?? null;
  const latestExecution = record.executions.at(-1) ?? null;
  const approvalTicket = latestApprovalTicket(artifacts);
  const reconciliationSummary = latestReconciliation(artifacts);
  const operatorSummary =
    artifacts.get<Record<string, unknown>>("report.operator-summary")?.data ??
    buildOperatorSummary(record, artifacts);

  return {
    runId: record.id,
    goal: record.goal,
    plane: record.plane,
    status: record.status,
    routeKind: record.routeKind,
    entrySkill: record.entrySkill ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    goalIntake,
    capabilitySnapshot: record.capabilitySnapshot,
    diagnosis,
    routeSummary: record.routeSummary ?? null,
    proposalTable: record.proposals,
    selectedProposal: record.selectedProposal ?? preferredProposalName(record.proposals) ?? null,
    policyDecision: record.policyDecision ?? null,
    approvalTicket,
    idempotencySummary: {
      checked: latestExecution?.idempotencyChecked ?? false,
      hitCount: idempotentHitCount(latestExecution ?? undefined),
      reconciliationState: latestExecution?.reconciliationState ?? "none",
    },
    reconciliationSummary,
    executionReceipts: record.executions,
    latestExecution,
    operatorSummary,
    errors: record.errors,
    notes: record.notes,
    nextActions: nextSafeAction(record),
  };
}

function exportReport(record: RunRecord, artifacts: ArtifactStore): string {
  const goalIntake = goalIntakeFromArtifacts(artifacts) ?? traceGoalIntake(record);
  const latestExecution = record.executions.at(-1);
  const selectedProposal = record.selectedProposal ?? preferredProposalName(record.proposals);
  const operatorSummary =
    artifacts.get<Record<string, unknown>>("report.operator-summary")?.data ??
    buildOperatorSummary(record, artifacts);
  const operatorBlockers = Array.isArray(operatorSummary.blockers)
    ? operatorSummary.blockers.filter((entry): entry is string => typeof entry === "string")
    : [];
  const operatorNextAction = typeof operatorSummary.nextSafeAction === "string"
    ? operatorSummary.nextSafeAction
    : "node dist/bin/trademesh.js replay <run-id>";
  const approvalTicket = latestApprovalTicket(artifacts);
  const reconcile = latestReconciliation(artifacts);
  return [
    `# TradeMesh Export Report`,
    "",
    markdownSection("Operator Snapshot", [
      `Executable now: ${operatorSummary.isExecutable === true ? "yes" : "no"}`,
      `Blockers: ${operatorBlockers.length > 0 ? operatorBlockers.join(" | ") : "none"}`,
      `Approval ticket: ${approvalTicket?.ticketId ?? "none"}`,
      `Idempotent hit count: ${idempotentHitCount(latestExecution ?? undefined)}`,
      `Needs reconcile: ${reconcile && reconcile.status !== "matched" ? "yes" : "no"}`,
      `Next safe action: ${operatorNextAction}`,
    ]),
    markdownSection("Summary", [
      `Run: ${record.id}`,
      `Goal: ${record.goal}`,
      `Plane: ${record.plane}`,
      `Status: ${record.status}`,
      `Selected proposal: ${selectedProposal ?? "n/a"}`,
    ]),
    markdownSection("Goal Interpretation", goalIntake
      ? [
          `Symbols: ${goalIntake.symbols.join(", ")}`,
          `Drawdown target: ${formatDrawdownPct(goalIntake.targetDrawdownPct)}`,
          `Intent: ${goalIntake.hedgeIntent}`,
          `Horizon: ${goalIntake.timeHorizon}`,
          `Execute preference: ${goalIntake.executePreference}`,
          `Warnings: ${goalIntake.warnings.length > 0 ? goalIntake.warnings.join(" | ") : "none"}`,
        ]
      : ["Goal intake was not captured."]),
    markdownSection("Environment Readiness", capabilityLines(record)),
    markdownSection("Proposal Ranking", proposalLines(record)),
    markdownSection("Selected Plan", [
      `Proposal: ${selectedProposal ?? "n/a"}`,
      ...actionabilityLines(record),
    ]),
    markdownSection("Policy Verdict", policyLines(record)),
    markdownSection(
      "Command Preview / Execution Receipt",
      latestExecution ? latestExecution.results.map(formatExecutionResult) : ["No execution receipt recorded."],
    ),
    markdownSection(
      "Evidence",
      Array.isArray(latestTraceEntry(record.trace, "replay")?.metadata?.evidence)
        ? latestTraceEntry(record.trace, "replay")?.metadata?.evidence as string[]
        : ["Replay evidence has not been materialized yet."],
    ),
    markdownSection("Next Safe Action", nextSafeAction(record)),
  ].join("\n");
}

export async function exportRun(runId: string, options: ExportOptions = {}): Promise<ExportResult> {
  const record = await loadNormalizedRun(runId);
  const manifests = await loadSkillRegistry();
  const operatorManifest = manifests.find((manifest) => manifest.name === "operator-summarizer");
  const sharedState: Record<string, unknown> = {};
  const artifacts = createArtifactStore(await loadArtifactSnapshot(runId), sharedState);
  const paths = exportPaths(runId, options.outputPath);
  await fs.mkdir(paths.outputDir, { recursive: true });

  let operatorSummary: Record<string, unknown>;
  if (operatorManifest) {
    await executeSkill(operatorManifest, {
      runId: record.id,
      goal: record.goal,
      plane: record.plane,
      manifests,
      trace: record.trace,
      artifacts,
      runtimeInput: {
        runStatus: record.status,
        latestExecution: record.executions.at(-1),
        nextSafeAction: operatorNextAction(record, artifacts),
      },
      sharedState,
    });
    operatorSummary =
      artifacts.get<Record<string, unknown>>("report.operator-summary")?.data ??
      buildOperatorSummary(record, artifacts);
  } else {
    operatorSummary = putOperatorSummaryArtifact(artifacts, record, "export-runtime");
  }
  const bundle = exportBundlePayload(record, artifacts);
  const report = exportReport(record, artifacts);

  await fs.writeFile(paths.bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  await fs.writeFile(paths.reportPath, `${report}\n`, "utf8");
  await fs.writeFile(paths.operatorSummaryPath, `${JSON.stringify(operatorSummary, null, 2)}\n`, "utf8");
  await saveArtifactSnapshot(runId, artifacts.snapshot());

  return {
    runId,
    outputDir: paths.outputDir,
    bundlePath: paths.bundlePath,
    reportPath: paths.reportPath,
    operatorSummaryPath: paths.operatorSummaryPath,
    summary: [
      "TradeMesh Export",
      `Run: ${runId}`,
      `Output dir: ${paths.outputDir}`,
      `Bundle: ${paths.bundlePath}`,
      `Report: ${paths.reportPath}`,
      `Operator summary: ${paths.operatorSummaryPath}`,
      `Preferred artifact: ${options.format === "json" ? paths.bundlePath : paths.reportPath}`,
    ].join("\n"),
  };
}

export function formatRunSummary(record: RunRecord): string {
  return record.executions.length > 0 ? formatApplySummary(record) : formatPlanSummary(record);
}

export function formatReplay(record: RunRecord): string {
  const replayEntry = [...record.trace].reverse().find((entry) => entry.skill === "replay");
  const operatorEntry = [...record.trace].reverse().find((entry) => entry.skill === "operator-summarizer");
  const operatorSummary = (operatorEntry?.metadata as { operatorSummary?: OperatorSummaryV3 } | undefined)?.operatorSummary;
  const timelineRaw = Array.isArray(replayEntry?.metadata?.timeline) ? replayEntry.metadata?.timeline as string[] : [];
  const artifactRaw = Array.isArray(replayEntry?.metadata?.artifacts) ? replayEntry.metadata?.artifacts as string[] : [];
  const evidenceRaw = Array.isArray(replayEntry?.metadata?.evidence) ? replayEntry.metadata?.evidence as string[] : [];
  const latestExecution = record.executions.at(-1);
  const selectedProposal = record.selectedProposal ?? preferredProposalName(record.proposals);
  const exportHint = hasExportBundle(record.id)
    ? `Latest export: ${exportPaths(record.id).outputDir}`
    : `Export: node dist/bin/trademesh.js export ${record.id}`;

  return [
    ...header("Replay Timeline", record),
    block("Operator Snapshot", [
      `Executable now: ${operatorSummary?.isExecutable ? "yes" : "no"}`,
      `Current blocker: ${operatorSummary && operatorSummary.blockers.length > 0 ? operatorSummary.blockers.join(" | ") : (latestExecution?.blockedReason ?? "none")}`,
      `Approval ticket: ${operatorSummary?.approval.ticketId ?? latestExecution?.approvalTicketId ?? "none"}`,
      `Idempotent hits: ${operatorSummary?.idempotency.hitCount ?? idempotentHitCount(latestExecution)}`,
      `Needs reconcile: ${operatorSummary?.reconciliation.required ? "yes" : "no"}`,
      `Next safe action: ${operatorSummary?.nextSafeAction ?? `node dist/bin/trademesh.js export ${record.id}`}`,
    ]),
    block("Run Snapshot", [
      `Approved: ${record.approved ? "yes" : "no"}`,
      `Selected proposal: ${selectedProposal ?? "n/a"}`,
      `Policy verdict: ${record.policyDecision?.outcome ?? "none"}`,
      `Execution verdict: ${latestExecution?.status ?? "none"}`,
    ]),
    block("Timeline", timelineRaw.length > 0 ? timelineRaw : ["No replay timeline captured."]),
    block("Artifact Handoffs", artifactRaw.length > 0 ? artifactRaw : ["No artifact handoffs captured."]),
    block("Policy Decision", policyLines(record)),
    block("Execution Receipt", latestExecution ? latestExecution.results.map(formatExecutionResult) : ["No execution receipt recorded."]),
    ...(evidenceRaw.length > 0 ? [block("Evidence", evidenceRaw)] : []),
    block("Export Pointer", [exportHint]),
  ].join("\n");
}
