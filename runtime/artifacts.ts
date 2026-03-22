import type {
  ArtifactKey,
  ArtifactSnapshot,
  ArtifactStore,
  GoalIntake,
  PortfolioSnapshot,
  SkillArtifact,
} from "./types.js";
import { validateArtifactEnvelope, validateArtifactSnapshot } from "./contracts.js";
import { currentArtifactVersion } from "./artifact-schema.js";

const ARTIFACT_TO_SHARED_STATE: Partial<Record<ArtifactKey, string[]>> = {
  "goal.intake": ["goalIntake"],
  "portfolio.snapshot": ["portfolioSnapshot", "accountSnapshot", "symbols", "drawdownTarget", "portfolioSource"],
  "portfolio.risk-profile": ["portfolioRiskProfile"],
  "market.snapshot": ["marketSnapshot"],
  "market.regime": ["marketRegime", "marketTrendScores"],
  "trade.thesis": ["tradeThesis"],
  "planning.proposals": ["proposals"],
  "planning.scenario-matrix": ["scenarioMatrix"],
  "policy.plan-decision": ["policyPlanDecision"],
  "execution.intent-bundle": ["executionIntentBundle"],
  "execution.apply-decision": ["applyDecision"],
  "execution.idempotency-check": ["idempotencyCheck"],
  "approval.ticket": ["approvalTicket"],
  "execution.reconciliation": ["reconciliationReport"],
  "report.operator-summary": ["operatorSummary"],
  "report.operator-brief": ["operatorBrief"],
  "mesh.skill-certification": ["skillCertification"],
  "mesh.route-proof": ["meshRouteProof"],
  "diagnostics.probes": ["diagnosticsProbes"],
  "diagnostics.readiness": ["diagnosticsReadiness"],
  "diagnostics.reason-catalog": ["diagnosticsReasonCatalog"],
  "operations.live-guard": ["liveGuard"],
  "operations.rehearsal-plan": ["rehearsalPlan"],
  "operations.rehearsal-receipt": ["rehearsalReceipt"],
};

function cloneArtifact<T>(artifact: SkillArtifact<T>): SkillArtifact<T> {
  return {
    ...artifact,
    data: artifact.data,
    ruleRefs: [...artifact.ruleRefs],
    doctrineRefs: [...artifact.doctrineRefs],
  };
}

function mirrorArtifactToSharedState(
  key: ArtifactKey,
  data: unknown,
  sharedState: Record<string, unknown>,
): void {
  const aliases = ARTIFACT_TO_SHARED_STATE[key] ?? [];
  for (const alias of aliases) {
    if (alias === "goalIntake" && key === "goal.intake") {
      sharedState[alias] = data as GoalIntake;
      continue;
    }

    if (alias === "portfolioSource" && key === "portfolio.snapshot") {
      const snapshot = data as PortfolioSnapshot;
      sharedState[alias] = snapshot.source;
      continue;
    }

    if (alias === "symbols" && key === "portfolio.snapshot") {
      const snapshot = data as PortfolioSnapshot;
      sharedState[alias] = snapshot.symbols;
      continue;
    }

    if (alias === "drawdownTarget" && key === "portfolio.snapshot") {
      const snapshot = data as PortfolioSnapshot;
      sharedState[alias] = snapshot.drawdownTarget;
      continue;
    }

    if (alias === "marketTrendScores" && key === "market.regime") {
      const regime = data as { trendScores?: unknown };
      sharedState[alias] = regime.trendScores ?? [];
      continue;
    }

    sharedState[alias] = data;
  }
}

class InMemoryArtifactStore implements ArtifactStore {
  private readonly store = new Map<ArtifactKey, SkillArtifact<unknown>>();

  constructor(
    initialSnapshot?: ArtifactSnapshot,
    private readonly sharedState?: Record<string, unknown>,
  ) {
    if (initialSnapshot) {
      validateArtifactSnapshot(initialSnapshot);
      for (const artifact of Object.values(initialSnapshot)) {
        if (!artifact) {
          continue;
        }
        this.store.set(artifact.key, cloneArtifact(artifact));
      }
    }

    if (this.sharedState) {
      for (const artifact of this.store.values()) {
        mirrorArtifactToSharedState(artifact.key, artifact.data, this.sharedState);
      }
    }
  }

  get<T = unknown>(key: ArtifactKey): SkillArtifact<T> | undefined {
    const artifact = this.store.get(key);
    return artifact ? (cloneArtifact(artifact) as SkillArtifact<T>) : undefined;
  }

  require<T = unknown>(key: ArtifactKey): SkillArtifact<T> {
    const artifact = this.get<T>(key);
    if (!artifact) {
      throw new Error(`Missing required artifact '${key}'`);
    }
    return artifact;
  }

  has(key: ArtifactKey): boolean {
    return this.store.has(key);
  }

  set<T = unknown>(artifact: SkillArtifact<T>): SkillArtifact<T> {
    validateArtifactEnvelope(artifact as SkillArtifact<unknown>);
    const normalized = cloneArtifact(artifact);
    this.store.set(artifact.key, normalized);
    if (this.sharedState) {
      mirrorArtifactToSharedState(artifact.key, normalized.data, this.sharedState);
    }
    return normalized as SkillArtifact<T>;
  }

  list(): SkillArtifact<unknown>[] {
    return [...this.store.values()].map((artifact) => cloneArtifact(artifact));
  }

  snapshot(): ArtifactSnapshot {
    const snapshot: ArtifactSnapshot = {};
    for (const artifact of this.store.values()) {
      snapshot[artifact.key] = cloneArtifact(artifact);
    }
    return snapshot;
  }
}

export function createArtifactStore(
  initialSnapshot?: ArtifactSnapshot,
  sharedState?: Record<string, unknown>,
): ArtifactStore {
  return new InMemoryArtifactStore(initialSnapshot, sharedState);
}

export function putArtifact<T>(
  store: ArtifactStore,
  input: {
    key: ArtifactKey;
    version: number;
    producer: string;
    data: T;
    ruleRefs?: string[];
    doctrineRefs?: string[];
  },
): SkillArtifact<T> {
  return store.set<T>({
    key: input.key,
    version: input.version || currentArtifactVersion(input.key),
    producer: input.producer,
    createdAt: new Date().toISOString(),
    data: input.data,
    ruleRefs: input.ruleRefs ?? [],
    doctrineRefs: input.doctrineRefs ?? [],
  });
}
