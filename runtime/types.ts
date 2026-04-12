export type ExecutionPlane = "research" | "demo" | "live";
export type SkillStage = "sensor" | "planner" | "guardrail" | "executor" | "memory";
export type SkillRole = "sensor" | "synthesizer" | "planner" | "guardrail" | "executor" | "memory";
export type PolicyPhase = "plan" | "apply";
export type ScenarioName =
  | "spot_down_5pct"
  | "spot_down_10pct"
  | "volatility_x2"
  | "correlation_to_one";
export type DoctrineId =
  | "turtle-trend"
  | "black-swan-risk"
  | "vol-hedging"
  | "discipline";
export type ArtifactKey =
  | "goal.intake"
  | "portfolio.snapshot"
  | "portfolio.risk-profile"
  | "market.snapshot"
  | "market.regime"
  | "trade.thesis"
  | "planning.proposals"
  | "planning.scenario-matrix"
  | "policy.plan-decision"
  | "execution.intent-bundle"
  | "execution.apply-decision"
  | "execution.idempotency-check"
  | "approval.ticket"
  | "execution.reconciliation"
  | "operations.receipt-verification"
  | "report.operator-summary"
  | "report.operator-brief"
  | "report.business-brief"
  | "mesh.skill-certification"
  | "mesh.route-proof"
  | "diagnostics.probes"
  | "diagnostics.readiness"
  | "diagnostics.reason-catalog"
  | "operations.live-guard"
  | "operations.rehearsal-plan"
  | "operations.rehearsal-receipt"
  | "identity.agent-wallet";
export type RunStatus =
  | "planned"
  | "approval_required"
  | "ready"
  | "blocked"
  | "dry_run"
  | "executed"
  | "failed"
  | "previewed";
export type GoalHedgeIntent = "protect_downside" | "reduce_beta" | "de_risk" | "unspecified";
export type GoalTimeHorizon = "intraday" | "swing" | "position" | "unspecified";
export type GoalExecutePreference = "plan_only" | "dry_run" | "execute";
export type GoalValueSource = "cli_flag" | "goal_parse" | "portfolio_inference" | "default";
export type ProposalExecutionReadiness =
  | "ready_for_dry_run"
  | "ready_for_demo_execute"
  | "env_missing"
  | "policy_blocked";
export type CapabilityRequirement =
  | "okx-cli"
  | "config"
  | "demo-profile"
  | "live-profile"
  | "market-read"
  | "account-read"
  | "swap-write"
  | "option-write"
  | "agent-wallet"
  | "chain:xlayer";
export type ProbeMode = "passive" | "active" | "write";
export type ProbeReasonCode =
  | "cli_missing"
  | "auth_failed"
  | "network_error"
  | "timeout"
  | "schema_mismatch"
  | "rate_limited"
  | "unknown";
export type DoctorStrictTarget = "plan" | "apply" | "execute";
export type ProbeModuleName =
  | "runtime"
  | "skills"
  | "okx-cli"
  | "config"
  | "profiles"
  | "market-read"
  | "account-read"
  | "write-path";
export type ProbeModuleLevel = "ready" | "degraded" | "blocked";
export type SkillSafetyClass = "read" | "write" | "mixed";
export type SkillDeterminism = "high" | "medium" | "low";
export type SkillProofClass = "portable" | "structural";

export interface ArtifactReference {
  key: ArtifactKey;
  producer?: string;
  version?: number;
}

export interface ProbeReceipt {
  module: ProbeModuleName;
  command: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  reasonCode?: ProbeReasonCode;
  nextActionCmd?: string;
  message?: string;
}

export interface ProbeReasonCatalogEntry {
  module: ProbeModuleName;
  reasonCode: ProbeReasonCode;
  message: string;
  nextActionCmd?: string;
}

export interface ProbeReasonCatalog {
  probeMode: ProbeMode;
  plane: ExecutionPlane;
  generatedAt: string;
  items: ProbeReasonCatalogEntry[];
}

export interface ProbeModuleStatus {
  module: ProbeModuleName;
  status: ProbeModuleLevel;
  reason: string;
  evidence: string[];
  nextAction: string;
}

export interface EnvironmentDiagnosis {
  probeMode: ProbeMode;
  plane: ExecutionPlane;
  strictTarget: DoctorStrictTarget;
  strictPass: boolean;
  modules: ProbeModuleStatus[];
  probeReceipts: ProbeReceipt[];
}

export interface GoalIntake {
  rawGoal: string;
  normalizedGoal: string;
  symbols: string[];
  targetDrawdownPct: number | null;
  hedgeIntent: GoalHedgeIntent;
  timeHorizon: GoalTimeHorizon;
  planePreference: ExecutionPlane | "unspecified";
  executePreference: GoalExecutePreference;
  sources: {
    symbols: GoalValueSource;
    targetDrawdownPct: Exclude<GoalValueSource, "portfolio_inference">;
    hedgeIntent: Exclude<GoalValueSource, "portfolio_inference">;
    timeHorizon: Exclude<GoalValueSource, "portfolio_inference">;
  };
  warnings: string[];
}

export interface GoalIntakeOverrides {
  symbols?: string[];
  targetDrawdownPct?: number;
  hedgeIntent?: Exclude<GoalHedgeIntent, "unspecified">;
  timeHorizon?: Exclude<GoalTimeHorizon, "unspecified">;
  executePreference?: GoalExecutePreference;
}

export interface ProposalEvidence {
  artifactRefs: ArtifactReference[];
  ruleRefs: string[];
  doctrineRefs: string[];
}

export interface ScenarioResult {
  scenario: ScenarioName;
  estimatedPnlUsd: number;
  estimatedDrawdownPct: number;
  estimatedMarginUseUsd: number;
  breachFlags: string[];
}

export type ScenarioMatrix = Record<ScenarioName, ScenarioResult>;

export interface RiskBudget {
  maxSingleOrderUsd: number;
  maxPremiumSpendUsd: number;
  maxMarginUseUsd: number;
  maxCorrelationBucketPct: number;
  maxTotalExposureUsd?: number;
}

export interface RiskBudgetUse {
  orderNotionalUsd?: number;
  premiumSpendUsd?: number;
  marginUseUsd?: number;
  correlationBucketPct?: number;
}

export interface ProposalScoreBreakdown {
  total: number;
  protection: number;
  cost: number;
  executionRisk: number;
  policyFit: number;
  dataConfidence: number;
}

export interface OkxCommandIntent {
  intentId: string;
  stepIndex: number;
  safeToRetry: boolean;
  clientOrderRef?: string;
  command: string;
  args: string[];
  module: string;
  requiresWrite: boolean;
  reason: string;
}

export interface CommandPreviewEntry {
  intentId: string;
  stepIndex: number;
  module: string;
  requiresWrite: boolean;
  safeToRetry: boolean;
  clientOrderRef?: string;
  reason: string;
  command: string;
}

export interface AgentWalletIdentity {
  walletAddress: string;
  chain: string;
  source: "runtime-input" | "env" | "demo-fallback" | "research-fallback";
  resolvedAt: string;
}

export interface ExecutionAction {
  actionId: string;
  stepIndex: number;
  kind: "swap-place-order" | "option-place-order" | "cross-chain-transfer" | "smart-contract-call";
  module: string;
  requiresWrite: boolean;
  safeToRetry: boolean;
  command: string;
  reason: string;
  wallet?: string;
  chain?: string;
  clientOrderRef?: string;
  integration?: string;
}

export interface ExecutionBundle {
  proposal: string;
  orderPlan: OrderPlanStep[];
  intents: OkxCommandIntent[];
  commandPreview: CommandPreviewEntry[];
  actions?: ExecutionAction[];
  actionPreview?: ExecutionAction[];
  wallet?: string;
  chain?: string;
  integration?: string;
}

export interface ApprovalTicket {
  ticketId: string;
  runId: string;
  proposal: string;
  plane: ExecutionPlane;
  approvedBy: string;
  reason: string;
  approvedAt: string;
  policyOutcome: PolicyDecision["outcome"];
  evidence: string[];
}

export interface IdempotencyLedgerEntry {
  seq: number;
  fingerprint: string;
  intentId: string;
  runId: string;
  proposal: string;
  plane: ExecutionPlane;
  module: string;
  requiresWrite: boolean;
  clientOrderRef?: string;
  command: string;
  status: "pending" | "executed" | "ambiguous";
  remoteOrderId?: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface IdempotencyEvent {
  seq: number;
  at: string;
  kind: "pending" | "executed" | "ambiguous";
  fingerprint: string;
  intentId: string;
  runId: string;
  proposal: string;
  plane: ExecutionPlane;
  module: string;
  requiresWrite: boolean;
  clientOrderRef?: string;
  command: string;
  remoteOrderId?: string;
  lastError?: string;
}

export interface IdempotencyLedgerV3 {
  version: 3;
  nextSeq: number;
  updatedAt: string;
  entries: Record<string, IdempotencyLedgerEntry>;
}

export type IdempotencyLedger = IdempotencyLedgerV3;

export interface ReconciliationItem {
  intentId: string;
  module: string;
  fingerprint: string;
  clientOrderRef?: string;
  status: "matched" | "ambiguous" | "failed";
  remoteOrderId?: string;
  reason: string;
  evidence: string[];
}

export interface ReconciliationReport {
  runId: string;
  reconciledAt: string;
  status: "matched" | "ambiguous" | "failed";
  items: ReconciliationItem[];
  attempts: Array<{
    attempt: number;
    at: string;
    source: "auto" | "client-id" | "fallback";
    windowMin: number;
    status: "matched" | "ambiguous" | "failed";
  }>;
  nextActions: string[];
}

export interface ReceiptVerification {
  status: "verified" | "pending" | "ambiguous" | "failed" | "not_applicable";
  plane: ExecutionPlane;
  executionId?: string;
  checkedAt: string;
  matchedBy: "client_order_ref" | "fallback_window" | "none";
  evidence: string[];
  nextAction: string;
}

export interface OperatorSummaryV3 {
  runId: string;
  plane: ExecutionPlane;
  status: RunStatus;
  isExecutable: boolean;
  blockers: string[];
  approval: {
    provided: boolean;
    ticketId: string | null;
    approvedBy: string | null;
    reason: string | null;
  };
  idempotency: {
    checked: boolean;
    hitCount: number;
    ledgerSeq: number | null;
  };
  reconciliation: {
    state: "none" | "pending" | "matched" | "ambiguous" | "failed";
    required: boolean;
  };
  nextSafeAction: string;
  requiresHumanAction: boolean;
  generatedAt: string;
}

export interface OperatorBrief {
  runId: string;
  isExecutable: boolean;
  currentBlocker: string;
  approvalState: string;
  idempotencyState: string;
  reconciliationState: "none" | "pending" | "matched" | "ambiguous" | "failed";
  nextSafeAction: string;
}

export interface BusinessBrief {
  goalSummary: string;
  recommendedAction: string;
  canActNow: boolean;
  currentBlocker: string;
  riskBudgetSummary: string;
  nextSafeAction: string;
}

export interface ManifestDigestProof {
  registryDigest: string;
  skillDigests: Record<string, string>;
  matchedCurrentRegistry: boolean;
  driftedSkills: string[];
  checkedAt: string;
}

export interface RouteProofMinimality {
  passed: boolean;
  redundantSkills: string[];
  reason: string;
}

export interface RouteProofStep {
  skill: string;
  disposition: "executed" | "skipped_satisfied";
  consumes: ArtifactKey[];
  produces: ArtifactKey[];
  unlockedNext: string[];
  standaloneRunnable: boolean;
  rerunCommand?: string;
  reason: string;
}

export interface RouteResumePoint {
  skill: string;
  requiredArtifacts: ArtifactKey[];
  rerunCommand: string;
}

export interface RouteProof {
  runId: string;
  routeKind: "workflow" | "standalone" | "operations";
  route: string[];
  targetOutputs: ArtifactKey[];
  proofPassed: boolean;
  minimality: RouteProofMinimality;
  steps: RouteProofStep[];
  resumePoints: RouteResumePoint[];
  contractDrift?: boolean;
  generatedAt: string;
}

export interface SkillCertificationItem {
  skill: string;
  contractComplete: boolean;
  standaloneRouteValid: boolean;
  standaloneOutputsUsable: boolean;
  proofClass: SkillProofClass;
  proofPassed: boolean;
  proofMode: "static" | "fixture-route";
  rerunnable: boolean;
  proofFailure?: string;
  rerunCommand?: string;
  passed: boolean;
  failures: string[];
}

export interface SkillCertificationReport {
  generatedAt: string;
  totalSkills: number;
  passedSkills: number;
  failedSkills: number;
  portableSkills: number;
  structuralSkills: number;
  portableProofPassed: number;
  rerunnableSkills: number;
  items: SkillCertificationItem[];
}

export interface SkillManifest {
  name: string;
  description: string;
  stage: SkillStage;
  role: SkillRole;
  requires: string[];
  riskLevel: "low" | "medium" | "high";
  writes: boolean;
  alwaysOn: boolean;
  triggers: string[];
  entrypoint?: string;
  path: string;
  consumes: ArtifactKey[];
  produces: ArtifactKey[];
  preferredHandoffs: string[];
  repeatable: boolean;
  artifactVersion: number;
  standaloneCommand: string;
  standaloneRoute: string[];
  standaloneInputs: Array<"goal" | "run-id" | ArtifactKey>;
  standaloneOutputs: ArtifactKey[];
  requiredCapabilities: CapabilityRequirement[];
  contractVersion: number;
  safetyClass: SkillSafetyClass;
  determinism: SkillDeterminism;
  proofClass: SkillProofClass;
  proofGoal?: string;
  proofFixture?: string;
  proofTargetOutputs: ArtifactKey[];
}

export interface SkillProposal {
  name: string;
  strategyId?: string;
  reason: string;
  estimatedCost?: string;
  estimatedProtection?: string;
  recommended?: boolean;
  actionable?: boolean;
  executionReadiness?: ProposalExecutionReadiness;
  capabilityGaps?: PolicyCapabilityGap[];
  scoreBreakdown?: ProposalScoreBreakdown;
  rejectionReason?: string;
  riskTags?: string[];
  evidence?: ProposalEvidence;
  scenarioMatrix?: ScenarioMatrix;
  riskBudgetUse?: RiskBudgetUse;
  decisionNotes?: string[];
  requiredModules?: string[];
  intents?: OkxCommandIntent[];
  cliIntents?: string[];
  orderPlan?: OrderPlanStep[];
}

export interface SwapPlaceOrderParams {
  instId: string;
  tdMode: "cross" | "isolated";
  side: "buy" | "sell";
  ordType: "market" | "limit" | "post_only" | "fok" | "ioc";
  sz: string;
  px?: string;
  reduceOnly?: boolean;
  posSide?: "long" | "short" | "net";
  tpTriggerPx?: string;
  tpOrdPx?: string;
  slTriggerPx?: string;
  slOrdPx?: string;
  clOrdId?: string;
  tag?: string;
}

export interface SwapOrderPlanStep {
  kind: "swap-place-order";
  purpose: string;
  symbol: string;
  targetNotionalUsd: number;
  referencePx: number;
  params: SwapPlaceOrderParams;
  riskTags?: string[];
}

export interface OptionPlaceOrderParams {
  instId: string;
  side: "buy" | "sell";
  sz: string;
  px: string;
}

export interface OptionOrderPlanStep {
  kind: "option-place-order";
  purpose: string;
  symbol: string;
  targetPremiumUsd: number;
  referencePx: number;
  params: OptionPlaceOrderParams;
  strategy?: "protective-put" | "collar";
  leg?: "protective-put" | "covered-call";
  riskTags?: string[];
}

export type OrderPlanStep = SwapOrderPlanStep | OptionOrderPlanStep;

export interface SkillRisk {
  score: number;
  maxLoss: string;
  needsApproval: boolean;
  reasons: string[];
}

export interface SkillPermissions {
  plane: ExecutionPlane;
  officialWriteOnly: boolean;
  allowedModules: string[];
}

export interface CapabilitySnapshot {
  okxCliAvailable: boolean;
  okxCliPath?: string;
  configPath: string;
  configExists: boolean;
  demoProfileLikelyConfigured: boolean;
  liveProfileLikelyConfigured: boolean;
  readinessGrade: "A" | "B" | "C" | "D";
  blockers: string[];
  recommendedPlane: ExecutionPlane | "none";
  warnings: string[];
}

export interface PolicyBudgetSnapshot {
  maxSingleOrderUsd: number;
  maxTotalOrderUsd: number;
  maxTotalExposureUsd: number;
  maxMarginUseUsd: number;
  maxPremiumSpendUsd: number;
  maxCorrelationBucketPct: number;
  marketVolatility: number | null;
  volatilityAdjusted: boolean;
  leverageAdjusted: boolean;
}

export interface PolicyCapabilityGap {
  id: string;
  severity: "info" | "warn" | "blocker";
  message: string;
  remedy: string;
}

export interface PolicyDecision {
  outcome: "approved" | "require_approval" | "blocked";
  reasons: string[];
  proposal: string;
  plane: ExecutionPlane;
  executeRequested: boolean;
  approvalProvided: boolean;
  evaluatedAt: string;
  phase?: PolicyPhase;
  ruleRefs?: string[];
  doctrineRefs?: string[];
  breachFlags?: string[];
  budgetSnapshot?: PolicyBudgetSnapshot;
  capabilityGaps?: PolicyCapabilityGap[];
}

export interface ExecutionResult {
  intent: OkxCommandIntent;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  skipped: boolean;
  dryRun: boolean;
  startedAt?: string;
  finishedAt?: string;
  durationMs: number;
  attempt?: number;
  errorCategory?: ExecutionErrorCategory;
  retryScheduled?: boolean;
}

export interface ExecutionRecord {
  executionId?: string;
  requestedAt: string;
  mode: "dry-run" | "execute";
  plane: ExecutionPlane;
  proposal: string;
  approvalProvided: boolean;
  status: RunStatus;
  results: ExecutionResult[];
  approvalTicketId?: string;
  idempotencyChecked?: boolean;
  idempotencyLedgerSeq?: number;
  reconciliationRequired?: boolean;
  reconciliationState?: "none" | "pending" | "matched" | "ambiguous" | "failed";
  doctorCheckedAt?: string;
  blockedReason?: string;
}

export type ExecutionErrorCategory = "retryable" | "fatal";

export interface RunErrorRecord {
  at: string;
  runId: string;
  proposal: string;
  intent: OkxCommandIntent;
  module: string;
  exitCode: number | null;
  category: ExecutionErrorCategory;
  message: string;
  attempt: number;
  retried: boolean;
}

export interface DirectionalExposure {
  longUsd: number;
  shortUsd: number;
  netUsd: number;
  dominantSide: "long" | "short" | "flat";
}

export interface ConcentrationTopSymbol {
  symbol: string;
  usd: number;
  sharePct: number;
}

export interface ConcentrationSummary {
  grossUsd: number;
  topSymbol: string;
  topSharePct: number;
  top3: ConcentrationTopSymbol[];
}

export interface CorrelationBucket {
  bucketId: string;
  symbols: string[];
  grossUsd: number;
  sharePct: number;
}

export interface LeverageHotspot {
  instId: string;
  symbol: string;
  leverage: number;
  notionalUsd: number;
}

export interface FeeDragSummary {
  makerRateBps?: number;
  takerRateBps?: number;
  recentFeePaidUsd: number;
  recentFeeRows: number;
}

export interface PortfolioRiskProfile {
  directionalExposure: DirectionalExposure;
  concentration: ConcentrationSummary;
  leverageHotspots: LeverageHotspot[];
  feeDrag: FeeDragSummary;
  correlationBuckets: CorrelationBucket[];
}

export interface PortfolioSnapshot {
  source: "okx-cli" | "fallback";
  symbols: string[];
  drawdownTarget: string;
  balance?: unknown;
  positions?: unknown;
  feeRates?: unknown;
  bills?: unknown;
  commands: string[];
  errors: string[];
  accountEquity: number;
  availableUsd: number | null;
}

export interface TrendScoreSummary {
  instId: string;
  direction: "up" | "down" | "sideways";
  strength: number;
  confidence: "low" | "medium" | "high";
  breakout: "up" | "down" | "none";
  atrPct: number | null;
}

export interface MarketRegime {
  symbols: string[];
  directionalRegime: "uptrend" | "downtrend" | "sideways";
  volState: "compressed" | "normal" | "elevated" | "stress";
  tailRiskState: "normal" | "elevated" | "stress";
  fundingState: "shorts-paying" | "neutral" | "longs-paying";
  conviction: number;
  trendScores: TrendScoreSummary[];
  marketVolatility: number | null;
  ruleRefs: string[];
  doctrineRefs: string[];
}

export interface TradeThesis {
  directionalRegime: "uptrend" | "downtrend" | "sideways";
  volState: "compressed" | "normal" | "elevated" | "stress";
  tailRiskState: "normal" | "elevated" | "stress";
  hedgeBias: "perp" | "protective-put" | "collar" | "de-risk";
  conviction: number;
  riskBudget: RiskBudget;
  disciplineState: "normal" | "cooldown" | "restricted";
  preferredStrategies: string[];
  decisionNotes: string[];
  ruleRefs: string[];
  doctrineRefs: string[];
}

export interface SkillArtifact<T = unknown> {
  key: ArtifactKey;
  version: number;
  producer: string;
  createdAt: string;
  data: T;
  ruleRefs: string[];
  doctrineRefs: string[];
}

export type ArtifactSnapshot = Partial<Record<ArtifactKey, SkillArtifact<unknown>>>;

export interface ArtifactStore {
  get<T = unknown>(key: ArtifactKey): SkillArtifact<T> | undefined;
  require<T = unknown>(key: ArtifactKey): SkillArtifact<T>;
  has(key: ArtifactKey): boolean;
  set<T = unknown>(artifact: SkillArtifact<T>): SkillArtifact<T>;
  list(): SkillArtifact<unknown>[];
  snapshot(): ArtifactSnapshot;
}

export interface SkillOutput {
  skill: string;
  stage: SkillStage;
  goal: string;
  summary: string;
  facts: string[];
  constraints: Record<string, unknown>;
  proposal: SkillProposal[];
  risk: SkillRisk;
  permissions: SkillPermissions;
  handoff: string | null;
  handoffReason?: string;
  producedArtifacts?: ArtifactKey[];
  consumedArtifacts?: ArtifactKey[];
  ruleRefs?: string[];
  doctrineRefs?: string[];
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface SkillContext {
  runId: string;
  goal: string;
  plane: ExecutionPlane;
  manifest: SkillManifest;
  manifests: SkillManifest[];
  trace: SkillOutput[];
  artifacts: ArtifactStore;
  runtimeInput: Record<string, unknown>;
  sharedState: Record<string, unknown>;
}

export type SkillHandler = (context: SkillContext) => Promise<SkillOutput>;

export interface RouteSummary {
  selectedSkills: string[];
  skippedSkills: string[];
  reasons: string[];
}

export interface JudgeSummary {
  headline: string;
  selectedProposal?: string;
  policyVerdict: string;
  executionVerdict: string;
}

export interface RunRecord {
  kind: "trademesh-run";
  version: 3;
  id: string;
  goal: string;
  plane: ExecutionPlane;
  status: RunStatus;
  routeKind: "workflow" | "standalone" | "operations";
  entrySkill?: string;
  route: string[];
  trace: SkillOutput[];
  facts: string[];
  constraints: Record<string, unknown>;
  proposals: SkillProposal[];
  risk: SkillRisk;
  permissions: SkillPermissions;
  capabilitySnapshot: CapabilitySnapshot;
  policyDecision?: PolicyDecision;
  approved: boolean;
  executions: ExecutionRecord[];
  errors: RunErrorRecord[];
  selectedProposal?: string;
  routeSummary?: RouteSummary;
  judgeSummary?: JudgeSummary;
  operatorState?: "stable" | "attention" | "blocked";
  lastSafeAction?: string;
  requiresHumanAction?: boolean;
  contractDrift?: boolean;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PortableRunBundle {
  bundleVersion: 1;
  runId: string;
  runtimeVersion: string;
  exportedAt: string;
  goal: string;
  plane: ExecutionPlane;
  status: RunStatus;
  routeKind: RunRecord["routeKind"];
  route: string[];
  artifactSnapshot: ArtifactSnapshot;
  operatorBrief: OperatorBrief;
  businessBrief: BusinessBrief;
  operatorSummary: OperatorSummaryV3;
  manifestProof: ManifestDigestProof;
  meshRouteProof?: RouteProof;
  skillCertification?: SkillCertificationReport | null;
  goalIntake?: GoalIntake | null;
  capabilitySnapshot?: CapabilitySnapshot;
  diagnosis?: EnvironmentDiagnosis | null;
  routeSummary?: RouteSummary | null;
  proposalTable?: SkillProposal[];
  selectedProposal?: string | null;
  policyDecision?: PolicyDecision | null;
  approvalTicket?: ApprovalTicket | null;
  idempotencySummary?: {
    checked: boolean;
    hitCount: number;
    reconciliationState: ExecutionRecord["reconciliationState"] | "none";
  };
  reconciliationSummary?: ReconciliationReport | null;
  executionReceipts?: ExecutionRecord[];
  latestExecution?: ExecutionRecord | null;
  errors?: RunErrorRecord[];
  notes?: string[];
  nextActions?: string[];
}
