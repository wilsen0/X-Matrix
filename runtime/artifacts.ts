import type {
  ArtifactKey,
  ArtifactSnapshot,
  ArtifactStore,
  PolicyDecision,
  PortfolioRiskProfile,
  PortfolioSnapshot,
  SkillArtifact,
  SkillProposal,
  TradeThesis,
} from "./types.js";
import { validateArtifactData, validateArtifactEnvelope, validateArtifactSnapshot } from "./contracts.js";
import { currentArtifactVersion, normalizeArtifactEnvelope } from "./migrations.js";

const ARTIFACT_TO_SHARED_STATE: Partial<Record<ArtifactKey, string[]>> = {
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

function buildLegacyArtifact(
  key: ArtifactKey,
  data: unknown,
): SkillArtifact<unknown> {
  validateArtifactData(key, data);
  return {
    key,
    version: 1,
    producer: "legacy-shared-state",
    createdAt: new Date().toISOString(),
    data,
    ruleRefs: [],
    doctrineRefs: [],
  };
}

function seedFromSharedState(
  sharedState: Record<string, unknown>,
  store: Map<ArtifactKey, SkillArtifact<unknown>>,
): string[] {
  const warnings: string[] = [];
  const seed = <T>(key: ArtifactKey, data: T | undefined, sourceLabel: string): void => {
    if (data === undefined || store.has(key)) {
      return;
    }
    const normalized = normalizeArtifactEnvelope(buildLegacyArtifact(key, data));
    store.set(key, normalized.artifact);
    warnings.push(`Legacy sharedState input '${sourceLabel}' seeded artifact '${key}'.`);
    warnings.push(...normalized.warnings);
  };

  seed("portfolio.snapshot", sharedState.portfolioSnapshot ?? sharedState.accountSnapshot, "portfolioSnapshot/accountSnapshot");
  seed("portfolio.risk-profile", sharedState.portfolioRiskProfile as PortfolioRiskProfile | undefined, "portfolioRiskProfile");
  seed("market.snapshot", sharedState.marketSnapshot, "marketSnapshot");
  seed("market.regime", sharedState.marketRegime, "marketRegime");
  seed("trade.thesis", sharedState.tradeThesis as TradeThesis | undefined, "tradeThesis");
  seed("planning.proposals", sharedState.proposals as SkillProposal[] | undefined, "proposals");
  seed("planning.scenario-matrix", sharedState.scenarioMatrix, "scenarioMatrix");
  seed("policy.plan-decision", sharedState.policyPlanDecision as PolicyDecision | undefined, "policyPlanDecision");
  seed("execution.intent-bundle", sharedState.executionIntentBundle, "executionIntentBundle");
  seed("execution.apply-decision", sharedState.applyDecision, "applyDecision");
  return warnings;
}

class InMemoryArtifactStore implements ArtifactStore {
  private readonly store = new Map<ArtifactKey, SkillArtifact<unknown>>();
  private readonly compatibilityWarnings: string[] = [];

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
        const normalized = normalizeArtifactEnvelope(artifact);
        this.compatibilityWarnings.push(...normalized.warnings);
        this.store.set(normalized.artifact.key, cloneArtifact(normalized.artifact));
      }
    }

    if (this.sharedState) {
      this.compatibilityWarnings.push(...seedFromSharedState(this.sharedState, this.store));
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
    const migrated = normalizeArtifactEnvelope(artifact as SkillArtifact<unknown>);
    validateArtifactEnvelope(migrated.artifact);
    this.compatibilityWarnings.push(...migrated.warnings);
    const normalized = cloneArtifact(migrated.artifact);
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

  legacyWarnings(): string[] {
    return [...this.compatibilityWarnings];
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
