import { executeIntent, inspectOkxEnvironment } from "./okx.js";
import { createArtifactStore, putArtifact } from "./artifacts.js";
import { runPlanningGraph } from "./graph-runtime.js";
import { evaluatePolicy } from "./policy.js";
import { loadSkillHandler, loadSkillRegistry } from "./registry.js";
import {
  createRunId,
  listRunIds,
  loadArtifactSnapshot,
  loadRun,
  saveArtifactSnapshot,
  saveRun,
} from "./trace.js";
import type {
  ArtifactStore,
  CapabilitySnapshot,
  ExecutionErrorCategory,
  ExecutionPlane,
  ExecutionRecord,
  ExecutionResult,
  OkxCommandIntent,
  OrderPlanStep,
  PolicyDecision,
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
}

interface ApplyOptions {
  plane?: ExecutionPlane;
  proposalName?: string;
  approve?: boolean;
  execute?: boolean;
}

interface ReplayOptions {
  skill?: string;
}

interface ExecutionBundle {
  proposal: string;
  orderPlan: OrderPlanStep[];
  intents: OkxCommandIntent[];
  commandPreview?: string[];
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
    warnings: ["Capability snapshot was missing on this run file."],
  };
}

function inferModuleFromCommand(command: string): string {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] === "okx" && tokens[1]) {
    return tokens[1];
  }

  return "unknown";
}

function inferWriteFromCommand(command: string, module: string): boolean {
  if (["swap", "option", "spot", "margin", "subaccount"].includes(module)) {
    return true;
  }

  return /\b(order|place|create|cancel|close|open)\b/i.test(command);
}

function toLegacyIntent(command: string): OkxCommandIntent {
  const module = inferModuleFromCommand(command);
  return {
    command,
    args: command.trim().split(/\s+/),
    module,
    requiresWrite: inferWriteFromCommand(command, module),
    reason: "Migrated from legacy cliIntents string command.",
  };
}

function normalizeProposal(proposal: SkillProposal): SkillProposal {
  const intents = proposal.intents && proposal.intents.length > 0
    ? proposal.intents
    : (proposal.cliIntents ?? []).map(toLegacyIntent);
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

function hydrateRecord(record: HydrateInput): RunRecord {
  const facts = collectFacts(record.trace);
  const constraints = collectConstraints(record.trace);
  const proposalsFromTrace = collectProposals(record.trace);
  const proposals = proposalsFromTrace.length > 0
    ? proposalsFromTrace
    : (record.legacyProposals ?? []).map(normalizeProposal);
  const risk = pickRunRisk(record.trace);
  const permissions = pickRunPermissions(record.trace, record.plane);

  return {
    ...record,
    status: normalizeStatus(record.status),
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
}

async function loadNormalizedRun(runId: string): Promise<RunRecord> {
  const loaded = await loadRun(runId);
  const capabilitySnapshot = loaded.capabilitySnapshot ?? (await inspectOkxEnvironment());

  return hydrateRecord({
    kind: "trademesh-run",
    version: 1,
    id: loaded.id,
    goal: loaded.goal,
    plane: loaded.plane,
    status: loaded.status,
    route: loaded.route,
    trace: loaded.trace,
    notes: loaded.notes ?? [],
    createdAt: loaded.createdAt,
    updatedAt: loaded.updatedAt,
    selectedProposal: loaded.selectedProposal,
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

function deriveLegacyTradeThesis(record: RunRecord): Record<string, unknown> {
  const preferredStrategies = record.proposals.map((proposal) => proposal.name);
  const topProposal = preferredStrategies[0] ?? "perp-short";
  const hedgeBias =
    topProposal === "protective-put"
      ? "protective-put"
      : topProposal === "collar"
        ? "collar"
        : topProposal === "de-risk" || topProposal === "deleverage-first"
          ? "de-risk"
          : "perp";

  return {
    directionalRegime: "sideways",
    volState: "normal",
    tailRiskState: "normal",
    hedgeBias,
    conviction: 50,
    riskBudget: {
      maxSingleOrderUsd: 5_000,
      maxPremiumSpendUsd: 1_000,
      maxMarginUseUsd: 4_000,
      maxCorrelationBucketPct: 40,
      maxTotalExposureUsd: 100_000,
    },
    disciplineState: "normal",
    preferredStrategies,
    decisionNotes: ["Migrated from legacy run record without artifacts snapshot."],
    ruleRefs: [],
    doctrineRefs: [],
  };
}

function seedSharedStateFromLegacyRun(record: RunRecord): Record<string, unknown> {
  const sharedState: Record<string, unknown> = {};
  const portfolioEntry = latestTraceEntry(record.trace, "portfolio-xray");
  const marketEntry = latestTraceEntry(record.trace, "market-scan");
  const thesisEntry = latestTraceEntry(record.trace, "trade-thesis");
  const replaylessProposals = record.proposals.map(normalizeProposal);

  const portfolioSnapshot = portfolioEntry?.metadata?.portfolioSnapshot;
  if (portfolioSnapshot && typeof portfolioSnapshot === "object") {
    sharedState.portfolioSnapshot = portfolioSnapshot;
  } else if (record.constraints.selectedSymbols || record.constraints.drawdownTarget) {
    sharedState.portfolioSnapshot = {
      source: "fallback",
      symbols: Array.isArray(record.constraints.selectedSymbols) ? record.constraints.selectedSymbols : [],
      drawdownTarget: typeof record.constraints.drawdownTarget === "string" ? record.constraints.drawdownTarget : "4%",
      commands: [],
      errors: ["Migrated from legacy run record."],
      accountEquity: 0,
      availableUsd: null,
    };
  }

  const riskProfile =
    portfolioEntry?.metadata?.riskProfile ??
    (typeof record.constraints.portfolioRiskProfile === "object" ? record.constraints.portfolioRiskProfile : undefined);
  if (riskProfile) {
    sharedState.portfolioRiskProfile = riskProfile;
  }

  if (marketEntry?.metadata?.regime && typeof marketEntry.metadata.regime === "object") {
    sharedState.marketRegime = marketEntry.metadata.regime;
  }

  if (thesisEntry?.metadata?.thesis && typeof thesisEntry.metadata.thesis === "object") {
    sharedState.tradeThesis = thesisEntry.metadata.thesis;
  } else {
    sharedState.tradeThesis = deriveLegacyTradeThesis(record);
  }

  if (replaylessProposals.length > 0) {
    sharedState.proposals = replaylessProposals;
  }

  return sharedState;
}

function compatibilityNotes(artifacts: ArtifactStore): string[] {
  return artifacts.legacyWarnings().map((warning) => `Compatibility warning: ${warning}`);
}

function proposalsFromArtifacts(artifacts: ArtifactStore): SkillProposal[] {
  const artifact = artifacts.get<SkillProposal[]>("planning.proposals")?.data;
  return Array.isArray(artifact) ? artifact.map(normalizeProposal) : [];
}

function resolveProposal(
  record: RunRecord,
  artifacts: ArtifactStore,
  proposalName?: string,
): SkillProposal {
  const proposals = proposalsFromArtifacts(artifacts);
  const fallback = proposals.length > 0 ? proposals : record.proposals.map(normalizeProposal);
  if (fallback.length === 0) {
    throw new Error(`Run ${record.id} does not contain executable proposals.`);
  }

  if (proposalName) {
    const explicit = fallback.find((proposal) => proposal.name === proposalName);
    if (!explicit) {
      throw new Error(`Proposal '${proposalName}' was not found in run ${record.id}.`);
    }
    return explicit;
  }

  if (record.selectedProposal) {
    const selected = fallback.find((proposal) => proposal.name === record.selectedProposal);
    if (selected) {
      return selected;
    }
  }

  return fallback[0];
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
    commandPreview: (normalized.intents ?? []).map((intent) => intent.command),
  };
}

function skippedResult(
  intent: OkxCommandIntent,
  executeRequested: boolean,
  reason: string,
): ExecutionResult {
  return {
    intent,
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: reason,
    skipped: true,
    dryRun: !executeRequested,
  };
}

interface ExecutionWithRecovery {
  results: ExecutionResult[];
  errors: RunErrorRecord[];
  finalResults: ExecutionResult[];
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
    if (category === "retryable") {
      firstAttempt.retryScheduled = true;
    }
    results.push(firstAttempt);
    errors.push(
      buildRunErrorRecord(options.runId, options.proposal, intent, firstAttempt, category, 1, category === "retryable"),
    );

    if (category === "retryable") {
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
      sharedState,
    },
  });
  const capabilitySnapshot = await inspectOkxEnvironment();
  const policyDecision = artifacts.get<PolicyDecision>("policy.plan-decision")?.data;
  const proposals = proposalsFromArtifacts(artifacts);
  const selectedProposal = proposals[0]?.name;
  const route = planningRouteWithTail(graph.route, manifests);

  const record = hydrateRecord({
    kind: "trademesh-run",
    version: 1,
    id: runId,
    goal,
    plane: options.plane,
    status: initialPlanStatus(policyDecision),
    route,
    trace: graph.trace,
    selectedProposal,
    policyDecision,
    capabilitySnapshot,
    executions: [],
    errors: [],
    notes: [
      "Plan created from the local skill registry.",
      "Planning executed through the graph-aware artifact runtime.",
      "Use apply --proposal <name> to select an execution path.",
      "Use --approve and --execute for explicit write execution.",
      `Initial plane: ${options.plane}`,
      ...compatibilityNotes(artifacts),
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
  if (!executorManifest) {
    throw new Error("No official-executor skill installed");
  }

  const targetPlane = options.plane ?? baseRecord.plane;
  const artifactSnapshot = await loadArtifactSnapshot(runId);
  const sharedState: Record<string, unknown> = {};
  if (Object.keys(artifactSnapshot).length === 0) {
    Object.assign(sharedState, seedSharedStateFromLegacyRun(baseRecord));
  }
  const artifacts = createArtifactStore(artifactSnapshot, sharedState);
  const capabilitySnapshot = await inspectOkxEnvironment();
  const proposal = resolveProposal(baseRecord, artifacts, options.proposalName);
  const decision = await evaluatePolicy({
    phase: "apply",
    artifacts,
    proposal,
    plane: targetPlane,
    approvalProvided: Boolean(options.approve),
    executeRequested: Boolean(options.execute),
    capabilitySnapshot,
  });

  putArtifact(artifacts, {
    key: "policy.plan-decision",
    version: 1,
    producer: "apply-runtime",
    data: decision,
    ruleRefs: decision.ruleRefs ?? [],
    doctrineRefs: decision.doctrineRefs ?? [],
  });
  putArtifact(artifacts, {
    key: "execution.apply-decision",
    version: 1,
    producer: "apply-runtime",
    data: decision,
    ruleRefs: decision.ruleRefs ?? [],
    doctrineRefs: decision.doctrineRefs ?? [],
  });

  sharedState.selectedProposal = proposal.name;
  sharedState.selectedProposalData = proposal;

  const traceWithoutReplay = baseRecord.trace.filter((entry) => entry.skill !== "replay");
  const executorOutput = await executeSkill(executorManifest, {
    runId: baseRecord.id,
    goal: baseRecord.goal,
    plane: targetPlane,
    manifests,
    trace: traceWithoutReplay,
    artifacts,
    sharedState,
  });

  const bundle = extractExecutionBundle(artifacts, proposal);
  const blockedReason = decision.outcome === "approved" ? undefined : decision.reasons.join("; ");
  const executionOutcome =
    decision.outcome === "approved"
      ? await executeWithRecovery(bundle.intents, {
          runId: baseRecord.id,
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
    plane: targetPlane,
    proposal: proposal.name,
    approvalProvided: Boolean(options.approve),
    status,
    results: executionOutcome.results,
    blockedReason,
  };

  const nextRecord = hydrateRecord({
    ...baseRecord,
    plane: targetPlane,
    status,
    selectedProposal: proposal.name,
    policyDecision: decision,
    trace: [...traceWithoutReplay, executorOutput],
    capabilitySnapshot,
    executions: [...baseRecord.executions, execution],
    errors: [...baseRecord.errors, ...executionOutcome.errors],
    notes: [
      ...baseRecord.notes,
      `Apply ${status}: ${decision.reasons.join(" | ")}`,
      ...(executionOutcome.errors.length > 0 ? [`Execution errors recorded: ${executionOutcome.errors.length}`] : []),
      ...compatibilityNotes(artifacts),
    ],
    updatedAt: now(),
  });

  await saveRun(nextRecord);
  await saveArtifactSnapshot(runId, artifacts.snapshot());
  return nextRecord;
}

export async function retryRun(runId: string): Promise<RunRecord> {
  const record = await loadNormalizedRun(runId);
  const latestFailedExecution = [...record.executions].reverse().find((execution) => execution.status === "failed");
  if (!latestFailedExecution) {
    throw new Error(`Run ${runId} has no failed execution to retry.`);
  }

  return applyRun(runId, {
    plane: latestFailedExecution.plane,
    proposalName: latestFailedExecution.proposal,
    approve: latestFailedExecution.approvalProvided || record.plane !== "research",
    execute: latestFailedExecution.mode === "execute",
  });
}

export async function replayRun(runId: string, options: ReplayOptions = {}): Promise<RunRecord> {
  const record = await loadNormalizedRun(runId);
  const manifests = await loadSkillRegistry();
  const replayManifest = manifests.find((manifest) => manifest.name === "replay");
  if (!replayManifest) {
    return record;
  }

  const sharedState: Record<string, unknown> = {
    replaySkillFilter: options.skill,
    latestExecutionResults: record.executions.at(-1)?.results ?? [],
  };
  const artifacts = createArtifactStore(await loadArtifactSnapshot(runId), sharedState);
  sharedState.replayCompatibilityWarnings = artifacts.legacyWarnings();
  const traceWithoutReplay = record.trace.filter((entry) => entry.skill !== "replay");
  const replayOutput = await executeSkill(replayManifest, {
    runId: record.id,
    goal: record.goal,
    plane: record.plane,
    manifests,
    trace: traceWithoutReplay,
    artifacts,
    sharedState,
  });

  const nextRecord = hydrateRecord({
    ...record,
    trace: [...traceWithoutReplay, replayOutput],
    updatedAt: now(),
  });

  await saveRun(nextRecord);
  await saveArtifactSnapshot(runId, artifacts.snapshot());
  return nextRecord;
}

interface RunListSummary {
  createdAt: string;
  goal: string;
  status: string;
}

function safeRunListSummary(raw: unknown): RunListSummary {
  if (!raw || typeof raw !== "object") {
    return {
      createdAt: "",
      goal: "(invalid run record)",
      status: "unknown",
    };
  }

  const record = raw as Partial<RunRecord>;
  return {
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    goal: typeof record.goal === "string" ? record.goal : "(missing goal)",
    status: typeof record.status === "string" ? record.status : "unknown",
  };
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
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const summary = runs
    .map((run) => `${run.createdAt || "n/a"} | ${run.status} | ${run.goal}`)
    .join("\n");

  return {
    runs,
    summary,
  };
}

export async function printSkillList(): Promise<{ manifests: SkillManifest[]; summary: string }> {
  const manifests = await loadSkillRegistry();
  const lines = manifests.map(
    (manifest) =>
      `${manifest.name.padEnd(18)} ${manifest.stage.padEnd(10)} ${manifest.writes ? "write" : "read "} ${manifest.description}`,
  );

  return {
    manifests,
    summary: lines.join("\n"),
  };
}

function formatExecutionResult(result: ExecutionResult): string {
  if (result.skipped) {
    return `[skip] ${result.intent.command}`;
  }

  if (result.ok) {
    return `[ok] ${result.intent.command}`;
  }

  return `[fail] ${result.intent.command}`;
}

export function formatRunSummary(record: RunRecord): string {
  const policy = record.policyDecision;
  const proposalLines = record.proposals.map((proposal, index) => {
    const normalized = normalizeProposal(proposal);
    const writeIntentCount = (normalized.intents ?? []).filter((intent) => intent.requiresWrite).length;

    return `${index + 1}. ${normalized.name} | cost=${normalized.estimatedCost ?? "n/a"} | protection=${normalized.estimatedProtection ?? "n/a"} | writeIntents=${writeIntentCount}`;
  });
  const summary = [
    `Run: ${record.id}`,
    `Status: ${record.status}`,
    `Plane: ${record.plane}`,
    `Goal: ${record.goal}`,
    `Route: ${record.route.join(" -> ")}`,
    `Capability: okx=${record.capabilitySnapshot.okxCliAvailable ? "yes" : "no"} demo=${record.capabilitySnapshot.demoProfileLikelyConfigured ? "yes" : "no"} live=${record.capabilitySnapshot.liveProfileLikelyConfigured ? "yes" : "no"}`,
    proposalLines.length ? "Proposals:" : "Proposals: none",
    ...proposalLines,
  ];

  if (policy) {
    summary.push(`Policy: ${policy.outcome}`);
    summary.push(...policy.reasons.map((reason) => `- ${reason}`));
  }

  const latestExecution = record.executions.at(-1);
  if (latestExecution) {
    summary.push(
      `Execution: mode=${latestExecution.mode} proposal=${latestExecution.proposal} status=${latestExecution.status}`,
    );
    if (latestExecution.blockedReason) {
      summary.push(`Execution blocked: ${latestExecution.blockedReason}`);
    }
    summary.push(...latestExecution.results.map(formatExecutionResult));
  }
  if (record.errors.length > 0) {
    const latestError = record.errors.at(-1)!;
    summary.push(
      `Errors: ${record.errors.length} (latest: ${latestError.category} ${latestError.intent.command} attempt=${latestError.attempt})`,
    );
  }

  return summary.join("\n");
}

export function formatReplay(record: RunRecord): string {
  const replayEntry = [...record.trace].reverse().find((entry) => entry.skill === "replay");
  const lines = [
    `Run: ${record.id}`,
    `Created: ${record.createdAt}`,
    `Updated: ${record.updatedAt}`,
    `Status: ${record.status}`,
    `Plane: ${record.plane}`,
    `Goal: ${record.goal}`,
    `Approved: ${record.approved ? "yes" : "no"}`,
    "",
  ];

  if (record.policyDecision) {
    lines.push(`policy: ${record.policyDecision.outcome}`);
    lines.push(`policy reasons: ${record.policyDecision.reasons.join(" | ")}`);
    lines.push("");
  }

  const replayFacts = replayEntry?.facts ?? [];
  if (replayFacts.length > 0) {
    lines.push(`facts: ${replayFacts.join(" | ")}`);
  }

  if (record.proposals.length > 0) {
    lines.push(`proposals: ${record.proposals.map((proposal) => proposal.name).join(", ")}`);
  }

  if (replayEntry) {
    const timelineRaw = replayEntry.metadata?.timeline;
    const artifactRaw = replayEntry.metadata?.artifacts;
    const evidenceRaw = replayEntry.metadata?.evidence;
    const compatibilityRaw = replayEntry.metadata?.compatibilityWarnings;
    if (Array.isArray(timelineRaw) && timelineRaw.length > 0) {
      lines.push("");
      lines.push("timeline:");
      lines.push(...timelineRaw.filter((item): item is string => typeof item === "string").map((item) => `- ${item}`));
    }
    if (Array.isArray(artifactRaw) && artifactRaw.length > 0) {
      lines.push("");
      lines.push("artifacts:");
      lines.push(...artifactRaw.filter((item): item is string => typeof item === "string").map((item) => `- ${item}`));
    }
    if (Array.isArray(evidenceRaw) && evidenceRaw.length > 0) {
      lines.push("");
      lines.push("evidence:");
      lines.push(...evidenceRaw.filter((item): item is string => typeof item === "string").map((item) => `- ${item}`));
    }
    if (Array.isArray(compatibilityRaw) && compatibilityRaw.length > 0) {
      lines.push("");
      lines.push("compatibility:");
      lines.push(...compatibilityRaw.filter((item): item is string => typeof item === "string").map((item) => `- ${item}`));
    }
  }

  if (record.executions.length > 0) {
    lines.push("");
    lines.push("executions:");
    for (const execution of record.executions) {
      lines.push(
        `- ${execution.requestedAt} mode=${execution.mode} proposal=${execution.proposal} status=${execution.status} approve=${execution.approvalProvided ? "yes" : "no"}`,
      );
      if (execution.blockedReason) {
        lines.push(`  blocked: ${execution.blockedReason}`);
      }
      for (const result of execution.results) {
        lines.push(`  ${formatExecutionResult(result)}`);
      }
    }
  }

  if (record.errors.length > 0) {
    lines.push("");
    lines.push("error-log:");
    for (const error of record.errors) {
      lines.push(
        `- ${error.at} category=${error.category} attempt=${error.attempt} module=${error.module} retried=${error.retried ? "yes" : "no"}`,
      );
      lines.push(`  command: ${error.intent.command}`);
      lines.push(`  message: ${error.message}`);
    }
  }

  return lines.join("\n");
}
