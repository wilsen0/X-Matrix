export type Plane = "research" | "demo" | "live";
export type RiskLevel = "low" | "medium" | "high";
export type RunStatus =
  | "planned"
  | "approval_required"
  | "ready"
  | "blocked"
  | "dry_run"
  | "executed"
  | "failed";

export interface SkillManifest {
  name: string;
  description: string;
  license?: string;
  metadata?: Record<string, unknown>;
  path: string;
  writes: boolean;
  riskLevel: RiskLevel;
  triggers: string[];
}

export interface SkillStep {
  skill: string;
  summary: string;
  facts?: string[];
}

export interface OkxCommandIntent {
  command: string;
  args: string[];
  requiresWrite: boolean;
  module: string;
  reason: string;
}

export interface ProposalOption {
  name: string;
  reason: string;
  estimatedCost?: string;
  estimatedProtection?: string;
  requiredModules: string[];
  intents: OkxCommandIntent[];
}

export interface RiskBlock {
  score: number;
  needsApproval: boolean;
  reasons: string[];
}

export interface PermissionBlock {
  plane: Plane;
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
}

export interface ExecutionResult {
  intent: OkxCommandIntent;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  skipped: boolean;
  dryRun: boolean;
}

export interface ExecutionRecord {
  requestedAt: string;
  mode: "dry-run" | "execute";
  plane: Plane;
  proposal: string;
  approvalProvided: boolean;
  status: RunStatus;
  results: ExecutionResult[];
  blockedReason?: string;
}

export interface RunRecord {
  id: string;
  goal: string;
  createdAt: string;
  status: RunStatus;
  chain: string[];
  steps: SkillStep[];
  facts: string[];
  constraints: Record<string, unknown>;
  proposals: ProposalOption[];
  risk: RiskBlock;
  permissions: PermissionBlock;
  capabilitySnapshot: CapabilitySnapshot;
  policyDecision?: PolicyDecision;
  approved: boolean;
  executions: ExecutionRecord[];
}

export interface CliOptions {
  plane?: Plane;
  json?: boolean;
  execute?: boolean;
  approve?: boolean;
  proposal?: string;
}
