import { executeIntent, inspectOkxEnvironment } from "./okx.js";
import { evaluateApplyPolicy } from "./policy.js";
import { loadSkillHandler, loadSkillRegistry } from "./registry.js";
import { buildPlanningRoute, buildRunRoute, resolveExecutor } from "./router.js";
import { createRunId, listRunIds, loadRun, saveRun } from "./trace.js";
import type {
  CapabilitySnapshot,
  ExecutionPlane,
  ExecutionErrorCategory,
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
  SwapOrderPlanStep,
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

function latestTraceEntry(trace: SkillOutput[], skillName: string): SkillOutput | undefined {
  return [...trace].reverse().find((entry) => entry.skill === skillName);
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
    requiredModules,
    intents,
  };
}

function parseIntentLike(raw: unknown): OkxCommandIntent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const command = typeof record.command === "string" ? record.command : null;
  const module = typeof record.module === "string" ? record.module : null;
  const reason = typeof record.reason === "string" ? record.reason : null;
  const requiresWrite = record.requiresWrite === true;
  if (!command || !module || !reason) {
    return null;
  }

  const args = Array.isArray(record.args)
    ? record.args.filter((item): item is string => typeof item === "string")
    : command.trim().split(/\s+/);
  if (args.length === 0) {
    return null;
  }

  return {
    command,
    args,
    module,
    requiresWrite,
    reason,
  };
}

function extractExecutorIntents(output: SkillOutput, fallbackIntents: OkxCommandIntent[]): OkxCommandIntent[] {
  const metadata = output.metadata;
  if (!metadata || typeof metadata !== "object") {
    return fallbackIntents;
  }

  const rawIntents = (metadata as Record<string, unknown>).intents;
  if (!Array.isArray(rawIntents)) {
    return fallbackIntents;
  }

  const parsed = rawIntents
    .map((intent) => parseIntentLike(intent))
    .filter((intent): intent is OkxCommandIntent => Boolean(intent));
  return parsed.length > 0 ? parsed : fallbackIntents;
}

function parseOrderPlanStepLike(raw: unknown): OrderPlanStep | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const paramsRaw = record.params;
  if (!paramsRaw || typeof paramsRaw !== "object" || Array.isArray(paramsRaw)) {
    return null;
  }
  const params = paramsRaw as Record<string, unknown>;
  const kind = record.kind;
  const purpose = record.purpose;
  const symbol = record.symbol;
  const targetNotionalUsd = record.targetNotionalUsd;
  const targetPremiumUsd = record.targetPremiumUsd;
  const referencePx = record.referencePx;
  const instId = params.instId;
  const side = params.side;
  const sz = params.sz;
  if (kind === "swap-place-order") {
    const tdMode = params.tdMode;
    const ordType = params.ordType;
    if (
      typeof purpose !== "string" ||
      typeof symbol !== "string" ||
      typeof targetNotionalUsd !== "number" ||
      typeof referencePx !== "number" ||
      typeof instId !== "string" ||
      typeof tdMode !== "string" ||
      typeof side !== "string" ||
      typeof ordType !== "string" ||
      typeof sz !== "string"
    ) {
      return null;
    }

    return raw as SwapOrderPlanStep;
  }

  if (kind === "option-place-order") {
    const px = params.px;
    if (
      typeof purpose !== "string" ||
      typeof symbol !== "string" ||
      typeof targetPremiumUsd !== "number" ||
      typeof referencePx !== "number" ||
      typeof instId !== "string" ||
      typeof side !== "string" ||
      typeof sz !== "string" ||
      typeof px !== "string"
    ) {
      return null;
    }

    return raw as OrderPlanStep;
  }

  return null;
}

function extractExecutorOrderPlan(
  output: SkillOutput,
  fallback: OrderPlanStep[] | undefined,
): OrderPlanStep[] | undefined {
  const metadata = output.metadata;
  if (!metadata || typeof metadata !== "object") {
    return fallback;
  }

  const rawOrderPlan = (metadata as Record<string, unknown>).orderPlan;
  if (!Array.isArray(rawOrderPlan)) {
    return fallback;
  }

  const parsed = rawOrderPlan
    .map((step) => parseOrderPlanStepLike(step))
    .filter((step): step is OrderPlanStep => Boolean(step));
  return parsed.length > 0 ? parsed : fallback;
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
  const policyRisk = [...trace].reverse().find((entry) => entry.skill === "policy-gate");
  if (policyRisk) {
    return policyRisk.risk;
  }

  const latestRisk = [...trace].reverse().find((entry) => entry.risk);
  if (latestRisk) {
    return latestRisk.risk;
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
  _trace: SkillOutput[],
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
  const proposals = collectProposals(record.trace);
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
    approved: deriveApproved(record.status, record.trace, record.policyDecision),
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
    capabilitySnapshot,
    executions: loaded.executions ?? [],
    errors: loaded.errors ?? [],
  });
}

function resolveProposal(record: RunRecord, proposalName?: string): SkillProposal {
  const proposals = record.proposals.map(normalizeProposal);
  if (proposals.length === 0) {
    throw new Error(`Run ${record.id} does not contain executable proposals.`);
  }

  if (proposalName) {
    const explicit = proposals.find((proposal) => proposal.name === proposalName);
    if (!explicit) {
      throw new Error(`Proposal '${proposalName}' was not found in run ${record.id}.`);
    }
    return explicit;
  }

  if (record.selectedProposal) {
    const selected = proposals.find((proposal) => proposal.name === record.selectedProposal);
    if (selected) {
      return selected;
    }
  }

  return proposals[0];
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
      errors.push(
        buildRunErrorRecord(options.runId, options.proposal, intent, secondAttempt, secondCategory, 2, false),
      );
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

export async function createPlan(goal: string, options: PlanOptions): Promise<RunRecord> {
  const manifests = await loadSkillRegistry();
  const planningRoute = buildPlanningRoute(goal, manifests);
  const route = buildRunRoute(goal, manifests);
  const runId = await createRunId();
  const trace: SkillOutput[] = [];
  const sharedState: Record<string, unknown> = {};

  for (const manifest of planningRoute) {
    const output = await executeSkill(manifest, {
      runId,
      goal,
      plane: options.plane,
      manifests,
      trace,
      sharedState,
    });

    trace.push(output);
  }

  const capabilitySnapshot = await inspectOkxEnvironment();

  let record = hydrateRecord({
    kind: "trademesh-run",
    version: 1,
    id: runId,
    goal,
    plane: options.plane,
    status: "planned",
    route,
    trace,
    policyDecision: undefined,
    capabilitySnapshot,
    executions: [],
    errors: [],
    notes: [
      "Plan created from the local skill registry.",
      "Use apply --proposal <name> to select an execution path.",
      "Use --approve and --execute for explicit high-risk execution.",
      `Initial plane: ${options.plane}`,
    ],
    createdAt: now(),
    updatedAt: now(),
  });

  if (record.risk.needsApproval && options.plane !== "research") {
    record = hydrateRecord({
      ...record,
      status: "approval_required",
      updatedAt: now(),
      notes: [...record.notes, "Run requires approval before non-research apply."],
    });
  }

  await saveRun(record);
  return record;
}

export async function applyRun(runId: string, options: ApplyOptions): Promise<RunRecord> {
  const baseRecord = await loadNormalizedRun(runId);
  const manifests = await loadSkillRegistry();
  const executorManifest = resolveExecutor(manifests);
  const targetPlane = options.plane ?? baseRecord.plane;
  const capabilitySnapshot = await inspectOkxEnvironment();

  const record = hydrateRecord({
    ...baseRecord,
    plane: targetPlane,
    capabilitySnapshot,
    updatedAt: now(),
  });

  const proposal = resolveProposal(record, options.proposalName);
  const plannerOutput = latestTraceEntry(record.trace, "hedge-planner");
  const portfolioOutput = latestTraceEntry(record.trace, "portfolio-xray");
  const selectedProposal = proposal.name;
  const proposalIntents = proposal.intents ?? [];

  const sharedState: Record<string, unknown> = {
    selectedProposal,
    selectedProposalIntents: proposalIntents,
    selectedProposalOrderPlan: proposal.orderPlan,
    selectedProposalData: proposal,
    applyDecision: "awaiting-policy",
    symbols: portfolioOutput?.metadata?.symbols,
    drawdownTarget: portfolioOutput?.metadata?.drawdownTarget,
    portfolioRiskProfile:
      portfolioOutput?.metadata?.riskProfile ??
      (typeof record.constraints.portfolioRiskProfile === "object"
        ? record.constraints.portfolioRiskProfile
        : undefined),
    plannerRank: plannerOutput?.metadata?.ranked,
  };

  const executorOutput = await executeSkill(executorManifest, {
    runId: record.id,
    goal: record.goal,
    plane: targetPlane,
    manifests,
    trace: record.trace,
    sharedState,
  });

  const recordForPolicy: RunRecord = {
    ...record,
    plane: targetPlane,
    permissions: {
      ...record.permissions,
      plane: targetPlane,
      allowedModules:
        targetPlane === record.permissions.plane
          ? record.permissions.allowedModules
          : allowedModulesForPlane(targetPlane),
      },
  };
  const intents = extractExecutorIntents(executorOutput, proposalIntents);
  const orderPlan = extractExecutorOrderPlan(executorOutput, proposal.orderPlan);
  const proposalForPolicy: SkillProposal = {
    ...proposal,
    intents,
    orderPlan,
    requiredModules: [...new Set(intents.map((intent) => intent.module))],
  };

  const decision = evaluateApplyPolicy({
    record: recordForPolicy,
    proposal: proposalForPolicy,
    plane: targetPlane,
    approvalProvided: Boolean(options.approve),
    executeRequested: Boolean(options.execute),
  });

  const mode = options.execute ? "execute" : "dry-run";
  const blockedReason = decision.outcome === "approved" ? undefined : decision.reasons.join("; ");
  const executionOutcome =
    decision.outcome === "approved"
      ? await executeWithRecovery(intents, {
          runId: record.id,
          proposal: selectedProposal,
          executeRequested: Boolean(options.execute),
        })
      : {
          results: intents.map((intent) =>
            skippedResult(intent, Boolean(options.execute), blockedReason ?? "blocked"),
          ),
          errors: [] as RunErrorRecord[],
          finalResults: intents.map((intent) =>
            skippedResult(intent, Boolean(options.execute), blockedReason ?? "blocked"),
          ),
        };
  const results = executionOutcome.results;
  const runErrors = executionOutcome.errors;

  const executionOk = executionOutcome.finalResults.every((result) => result.ok);
  const status = nextStatusFromPolicy(decision.outcome, Boolean(options.execute), executionOk);

  const execution: ExecutionRecord = {
    requestedAt: now(),
    mode,
    plane: targetPlane,
    proposal: selectedProposal,
    approvalProvided: Boolean(options.approve),
    status,
    results,
    blockedReason,
  };

  const nextRecord = hydrateRecord({
    ...record,
    status,
    plane: targetPlane,
    selectedProposal,
    policyDecision: decision,
    trace: [...record.trace, executorOutput],
    capabilitySnapshot,
    executions: [...record.executions, execution],
    errors: [...record.errors, ...runErrors],
    notes: [
      ...record.notes,
      `Apply ${status}: ${decision.reasons.join(" | ")}`,
      ...(runErrors.length > 0 ? [`Execution errors recorded: ${runErrors.length}`] : []),
    ],
    updatedAt: now(),
  });

  await saveRun(nextRecord);
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

  const latestExecution = record.executions.at(-1);
  const sharedState: Record<string, unknown> = {
    replaySkillFilter: options.skill,
    runPolicyDecision: record.policyDecision,
    latestExecutionResults: latestExecution?.results ?? [],
  };
  const replayOutput = await executeSkill(replayManifest, {
    runId: record.id,
    goal: record.goal,
    plane: record.plane,
    manifests,
    trace: record.trace,
    sharedState,
  });
  const traceWithoutReplay = record.trace.filter((entry) => entry.skill !== "replay");

  return hydrateRecord({
    ...record,
    trace: [...traceWithoutReplay, replayOutput],
    updatedAt: now(),
  });
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
  const replaySkillFilterRaw = replayEntry?.metadata?.skillFilter;
  const replaySkillFilter =
    typeof replaySkillFilterRaw === "string" && replaySkillFilterRaw.trim().length > 0
      ? replaySkillFilterRaw.trim().toLowerCase()
      : null;
  const lines = [
    `Run: ${record.id}`,
    `Created: ${record.createdAt}`,
    `Updated: ${record.updatedAt}`,
    `Status: ${record.status}`,
    `Plane: ${record.plane}`,
    `Goal: ${record.goal}`,
    `Approved: ${record.approved ? "yes" : "no"}`,
    `Capability: okx=${record.capabilitySnapshot.okxCliAvailable ? "yes" : "no"} demo=${record.capabilitySnapshot.demoProfileLikelyConfigured ? "yes" : "no"} live=${record.capabilitySnapshot.liveProfileLikelyConfigured ? "yes" : "no"}`,
    "",
  ];

  if (record.policyDecision) {
    lines.push(`policy: ${record.policyDecision.outcome}`);
    lines.push(`policy reasons: ${record.policyDecision.reasons.join(" | ")}`);
    lines.push("");
  }

  const replayFacts = replayEntry?.facts ?? [];
  const topFacts = replayFacts.length > 0 ? replayFacts : record.facts;
  if (topFacts.length > 0) {
    lines.push(`facts: ${topFacts.join(" | ")}`);
  }

  if (record.proposals.length > 0) {
    lines.push(`proposals: ${record.proposals.map((proposal) => proposal.name).join(", ")}`);
  }
  if (record.errors.length > 0) {
    lines.push(`errors: ${record.errors.length}`);
  }

  if (replayEntry) {
    lines.push("");
    lines.push("decision-chain:");
    lines.push(...replayEntry.facts.map((fact) => `- ${fact}`));

    const timelineRaw = replayEntry.metadata?.timeline;
    if (Array.isArray(timelineRaw) && timelineRaw.length > 0) {
      lines.push("");
      lines.push("timeline:");
      lines.push(
        ...timelineRaw
          .map((item) => (typeof item === "string" ? item : null))
          .filter((item): item is string => Boolean(item))
          .map((item) => `- ${item}`),
      );
    }
  }

  lines.push("");

  const detailTrace = record.trace.filter((item) => {
    if (item.skill === "replay") {
      return false;
    }
    if (!replaySkillFilter) {
      return true;
    }
    return item.skill.toLowerCase() === replaySkillFilter;
  });
  for (const entry of detailTrace) {
    lines.push(`[${entry.stage}] ${entry.skill}`);
    lines.push(`summary: ${entry.summary}`);
    lines.push(`handoff: ${entry.handoff ?? "none"}`);
    lines.push(
      `risk: score=${entry.risk.score} maxLoss=${entry.risk.maxLoss} needsApproval=${entry.risk.needsApproval}`,
    );
    if (entry.facts.length > 0) {
      lines.push(`facts: ${entry.facts.join(" | ")}`);
    }
    if (entry.proposal.length > 0) {
      lines.push(`proposal: ${entry.proposal.map((proposal) => proposal.name).join(", ")}`);
    }
    lines.push("");
  }
  if (replaySkillFilter && detailTrace.length === 0) {
    lines.push(`No detailed trace entry matched --skill ${replaySkillFilter}.`);
    lines.push("");
  }

  if (record.executions.length > 0) {
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
