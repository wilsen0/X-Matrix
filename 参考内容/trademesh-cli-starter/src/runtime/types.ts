export type Plane = "research" | "demo" | "live";

export interface SkillManifest {
  name: string;
  description: string;
  license?: string;
  metadata?: Record<string, unknown>;
  path: string;
}

export interface SkillStep {
  skill: string;
  summary: string;
  facts?: string[];
}

export interface ProposalOption {
  name: string;
  reason: string;
  estimatedCost?: string;
  estimatedProtection?: string;
  cliIntents?: string[];
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

export interface RunRecord {
  id: string;
  goal: string;
  createdAt: string;
  chain: string[];
  steps: SkillStep[];
  facts: string[];
  constraints: Record<string, unknown>;
  proposals: ProposalOption[];
  risk: RiskBlock;
  permissions: PermissionBlock;
  approved: boolean;
}

export interface OkxCommandIntent {
  command: string;
  requiresWrite: boolean;
  module: string;
}
