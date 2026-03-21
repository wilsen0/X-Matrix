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
  | "execution.apply-decision";
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

export interface ArtifactReference {
  key: ArtifactKey;
  producer?: string;
  version?: number;
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
  reason: string;
  command: string;
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
  durationMs: number;
  attempt?: number;
  errorCategory?: ExecutionErrorCategory;
  retryScheduled?: boolean;
}

export interface ExecutionRecord {
  requestedAt: string;
  mode: "dry-run" | "execute";
  plane: ExecutionPlane;
  proposal: string;
  approvalProvided: boolean;
  status: RunStatus;
  results: ExecutionResult[];
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
  version: 1;
  id: string;
  goal: string;
  plane: ExecutionPlane;
  status: RunStatus;
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
  notes: string[];
  createdAt: string;
  updatedAt: string;
}
