export type ExecutionPlane = "research" | "demo" | "live";
export type SkillStage = "sensor" | "planner" | "guardrail" | "executor" | "memory";
export type RunStatus =
  | "planned"
  | "approval_required"
  | "ready"
  | "blocked"
  | "dry_run"
  | "executed"
  | "failed"
  | "previewed";

export interface OkxCommandIntent {
  command: string;
  args: string[];
  module: string;
  requiresWrite: boolean;
  reason: string;
}

export interface SkillManifest {
  name: string;
  description: string;
  stage: SkillStage;
  requires: string[];
  riskLevel: "low" | "medium" | "high";
  writes: boolean;
  alwaysOn: boolean;
  triggers: string[];
  entrypoint?: string;
  path: string;
}

export interface SkillProposal {
  name: string;
  reason: string;
  estimatedCost?: string;
  estimatedProtection?: string;
  riskTags?: string[];
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
  warnings: string[];
}

export interface PolicyDecision {
  outcome: "approved" | "require_approval" | "blocked";
  reasons: string[];
  proposal: string;
  plane: ExecutionPlane;
  executeRequested: boolean;
  approvalProvided: boolean;
  evaluatedAt: string;
}

export interface ExecutionResult {
  intent: OkxCommandIntent;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  skipped: boolean;
  dryRun: boolean;
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
  sharedState: Record<string, unknown>;
}

export type SkillHandler = (context: SkillContext) => Promise<SkillOutput>;

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
  notes: string[];
  createdAt: string;
  updatedAt: string;
}
