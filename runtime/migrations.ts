import type {
  ArtifactKey,
  ArtifactReference,
  OrderPlanStep,
  PolicyDecision,
  RiskBudget,
  SkillArtifact,
  SkillProposal,
  TradeThesis,
} from "./types.js";

const CURRENT_ARTIFACT_VERSIONS: Record<ArtifactKey, number> = {
  "portfolio.snapshot": 2,
  "portfolio.risk-profile": 2,
  "market.snapshot": 2,
  "market.regime": 2,
  "trade.thesis": 2,
  "planning.proposals": 2,
  "planning.scenario-matrix": 2,
  "policy.plan-decision": 2,
  "execution.intent-bundle": 2,
  "execution.apply-decision": 2,
};

type JsonRecord = Record<string, unknown>;

function asObject(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function defaultRiskBudget(base?: Partial<RiskBudget>): RiskBudget {
  return {
    maxSingleOrderUsd: typeof base?.maxSingleOrderUsd === "number" ? base.maxSingleOrderUsd : 5_000,
    maxPremiumSpendUsd: typeof base?.maxPremiumSpendUsd === "number" ? base.maxPremiumSpendUsd : 1_000,
    maxMarginUseUsd: typeof base?.maxMarginUseUsd === "number" ? base.maxMarginUseUsd : 4_000,
    maxCorrelationBucketPct:
      typeof base?.maxCorrelationBucketPct === "number" ? base.maxCorrelationBucketPct : 40,
    maxTotalExposureUsd:
      typeof base?.maxTotalExposureUsd === "number" ? base.maxTotalExposureUsd : 100_000,
  };
}

function defaultPreferredStrategies(hedgeBias: unknown): string[] {
  if (hedgeBias === "protective-put") {
    return ["protective-put", "collar", "perp-short", "de-risk"];
  }
  if (hedgeBias === "collar") {
    return ["collar", "protective-put", "perp-short", "de-risk"];
  }
  if (hedgeBias === "de-risk") {
    return ["de-risk", "protective-put", "collar", "perp-short"];
  }
  return ["perp-short", "protective-put", "collar", "de-risk"];
}

function normalizeArtifactRefs(value: unknown): ArtifactReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asObject(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => ({
      key: entry.key as ArtifactKey,
      producer: typeof entry.producer === "string" ? entry.producer : undefined,
      version: typeof entry.version === "number" ? entry.version : undefined,
    }));
}

function normalizeProposal(proposal: unknown): SkillProposal {
  const record = asObject(proposal) ?? {};
  const name = typeof record.name === "string" ? record.name : "unknown-proposal";
  const strategyId =
    typeof record.strategyId === "string"
      ? record.strategyId
      : name === "protective-put" || name === "collar" || name === "de-risk" || name === "perp-short"
        ? name
        : name === "directional-net-hedge"
          ? "perp-short"
          : name === "deleverage-first"
            ? "de-risk"
            : "perp-short";

  return {
    name,
    strategyId,
    reason: typeof record.reason === "string" ? record.reason : "Migrated proposal.",
    estimatedCost: typeof record.estimatedCost === "string" ? record.estimatedCost : undefined,
    estimatedProtection:
      typeof record.estimatedProtection === "string" ? record.estimatedProtection : undefined,
    riskTags: stringArray(record.riskTags),
    evidence: {
      artifactRefs: normalizeArtifactRefs(record.evidence && asObject(record.evidence)?.artifactRefs),
      ruleRefs: stringArray(record.evidence && asObject(record.evidence)?.ruleRefs),
      doctrineRefs: stringArray(record.evidence && asObject(record.evidence)?.doctrineRefs),
    },
    scenarioMatrix: asObject(record.scenarioMatrix) ? (record.scenarioMatrix as SkillProposal["scenarioMatrix"]) : undefined,
    riskBudgetUse: asObject(record.riskBudgetUse) ? (record.riskBudgetUse as SkillProposal["riskBudgetUse"]) : undefined,
    decisionNotes: stringArray(record.decisionNotes),
    requiredModules: stringArray(record.requiredModules),
    intents: Array.isArray(record.intents) ? (record.intents as SkillProposal["intents"]) : undefined,
    cliIntents: stringArray(record.cliIntents),
    orderPlan: Array.isArray(record.orderPlan) ? (record.orderPlan as OrderPlanStep[]) : undefined,
  };
}

function migrateArtifactDataV1ToV2(key: ArtifactKey, data: unknown): unknown {
  const record = asObject(data);

  switch (key) {
    case "portfolio.snapshot":
      return {
        source: record?.source === "okx-cli" ? "okx-cli" : "fallback",
        symbols: Array.isArray(record?.symbols) ? record.symbols : [],
        drawdownTarget: typeof record?.drawdownTarget === "string" ? record.drawdownTarget : "4%",
        balance: record?.balance,
        positions: record?.positions,
        feeRates: record?.feeRates,
        bills: record?.bills,
        commands: stringArray(record?.commands),
        errors: stringArray(record?.errors),
        accountEquity: typeof record?.accountEquity === "number" ? record.accountEquity : 0,
        availableUsd: typeof record?.availableUsd === "number" ? record.availableUsd : null,
      };
    case "portfolio.risk-profile":
      return {
        directionalExposure: asObject(record?.directionalExposure) ?? {
          longUsd: 0,
          shortUsd: 0,
          netUsd: 0,
          dominantSide: "flat",
        },
        concentration: asObject(record?.concentration) ?? {
          grossUsd: 0,
          topSymbol: "n/a",
          topSharePct: 0,
          top3: [],
        },
        leverageHotspots: Array.isArray(record?.leverageHotspots) ? record.leverageHotspots : [],
        feeDrag: asObject(record?.feeDrag) ?? {
          recentFeePaidUsd: 0,
          recentFeeRows: 0,
        },
        correlationBuckets: Array.isArray(record?.correlationBuckets) ? record.correlationBuckets : [],
      };
    case "market.snapshot":
      return {
        source: record?.source === "okx-cli" ? "okx-cli" : "fallback",
        tickers: asObject(record?.tickers) ?? {},
        candles: asObject(record?.candles) ?? {},
        fundingRates: asObject(record?.fundingRates) ?? {},
        orderbooks: asObject(record?.orderbooks) ?? {},
        commands: stringArray(record?.commands),
        errors: stringArray(record?.errors),
      };
    case "market.regime":
      return {
        symbols: Array.isArray(record?.symbols) ? record.symbols : [],
        directionalRegime:
          record?.directionalRegime === "uptrend" || record?.directionalRegime === "downtrend"
            ? record.directionalRegime
            : "sideways",
        volState:
          record?.volState === "compressed" || record?.volState === "elevated" || record?.volState === "stress"
            ? record.volState
            : "normal",
        tailRiskState:
          record?.tailRiskState === "elevated" || record?.tailRiskState === "stress"
            ? record.tailRiskState
            : "normal",
        fundingState:
          record?.fundingState === "longs-paying" || record?.fundingState === "shorts-paying"
            ? record.fundingState
            : "neutral",
        conviction: typeof record?.conviction === "number" ? record.conviction : 35,
        trendScores: Array.isArray(record?.trendScores) ? record.trendScores : [],
        marketVolatility: typeof record?.marketVolatility === "number" ? record.marketVolatility : null,
        ruleRefs: stringArray(record?.ruleRefs),
        doctrineRefs: stringArray(record?.doctrineRefs),
      };
    case "trade.thesis": {
      const thesis = record as Partial<TradeThesis> | undefined;
      return {
        directionalRegime:
          thesis?.directionalRegime === "uptrend" || thesis?.directionalRegime === "downtrend"
            ? thesis.directionalRegime
            : "sideways",
        volState:
          thesis?.volState === "compressed" || thesis?.volState === "elevated" || thesis?.volState === "stress"
            ? thesis.volState
            : "normal",
        tailRiskState:
          thesis?.tailRiskState === "elevated" || thesis?.tailRiskState === "stress"
            ? thesis.tailRiskState
            : "normal",
        hedgeBias:
          thesis?.hedgeBias === "protective-put" || thesis?.hedgeBias === "collar" || thesis?.hedgeBias === "de-risk"
            ? thesis.hedgeBias
            : "perp",
        conviction: typeof thesis?.conviction === "number" ? thesis.conviction : 50,
        riskBudget: defaultRiskBudget(thesis?.riskBudget),
        disciplineState:
          thesis?.disciplineState === "cooldown" || thesis?.disciplineState === "restricted"
            ? thesis.disciplineState
            : "normal",
        preferredStrategies:
          Array.isArray(thesis?.preferredStrategies) && thesis.preferredStrategies.length > 0
            ? thesis.preferredStrategies
            : defaultPreferredStrategies(thesis?.hedgeBias),
        decisionNotes: Array.isArray(thesis?.decisionNotes) ? thesis.decisionNotes : [],
        ruleRefs: Array.isArray(thesis?.ruleRefs) ? thesis.ruleRefs : [],
        doctrineRefs: Array.isArray(thesis?.doctrineRefs) ? thesis.doctrineRefs : [],
      };
    }
    case "planning.proposals":
      return Array.isArray(data) ? data.map((proposal) => normalizeProposal(proposal)) : [];
    case "planning.scenario-matrix":
      return record ?? {};
    case "policy.plan-decision":
    case "execution.apply-decision": {
      const decision = record as Partial<PolicyDecision> | undefined;
      const budgetSnapshot = asObject(decision?.budgetSnapshot) ? decision?.budgetSnapshot : undefined;
      return {
        outcome:
          decision?.outcome === "approved" || decision?.outcome === "require_approval" || decision?.outcome === "blocked"
            ? decision.outcome
            : "blocked",
        reasons: Array.isArray(decision?.reasons) ? decision.reasons : [],
        proposal: typeof decision?.proposal === "string" ? decision.proposal : "unknown-proposal",
        plane:
          decision?.plane === "demo" || decision?.plane === "live" || decision?.plane === "research"
            ? decision.plane
            : "research",
        executeRequested: decision?.executeRequested === true,
        approvalProvided: decision?.approvalProvided === true,
        evaluatedAt: typeof decision?.evaluatedAt === "string" ? decision.evaluatedAt : new Date().toISOString(),
        phase:
          decision?.phase === "plan" || decision?.phase === "apply"
            ? decision.phase
            : key === "execution.apply-decision"
              ? "apply"
              : "plan",
        ruleRefs: Array.isArray(decision?.ruleRefs) ? decision.ruleRefs : [],
        doctrineRefs: Array.isArray(decision?.doctrineRefs) ? decision.doctrineRefs : [],
        breachFlags: Array.isArray(decision?.breachFlags) ? decision.breachFlags : [],
        budgetSnapshot,
      };
    }
    case "execution.intent-bundle":
      return {
        proposal: typeof record?.proposal === "string" ? record.proposal : "unknown-proposal",
        orderPlan: Array.isArray(record?.orderPlan) ? record.orderPlan : [],
        intents: Array.isArray(record?.intents) ? record.intents : [],
        commandPreview: Array.isArray(record?.commandPreview)
          ? record.commandPreview
          : Array.isArray(record?.intents)
            ? record.intents
                .map((intent) => asObject(intent)?.command)
                .filter((command): command is string => typeof command === "string")
            : [],
      };
  }
}

export function currentArtifactVersion(key: ArtifactKey): number {
  return CURRENT_ARTIFACT_VERSIONS[key];
}

export function normalizeArtifactEnvelope<T>(
  artifact: SkillArtifact<T>,
): { artifact: SkillArtifact<unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const targetVersion = currentArtifactVersion(artifact.key);
  if (artifact.version > targetVersion) {
    throw new Error(
      `Artifact '${artifact.key}' uses unsupported future version ${artifact.version} (current=${targetVersion}).`,
    );
  }

  let normalized: SkillArtifact<unknown> = {
    ...artifact,
    ruleRefs: Array.isArray(artifact.ruleRefs) ? [...artifact.ruleRefs] : [],
    doctrineRefs: Array.isArray(artifact.doctrineRefs) ? [...artifact.doctrineRefs] : [],
  };

  while (normalized.version < targetVersion) {
    if (normalized.version === 1 && targetVersion >= 2) {
      normalized = {
        ...normalized,
        version: 2,
        data: migrateArtifactDataV1ToV2(normalized.key, normalized.data),
        ruleRefs: Array.isArray(normalized.ruleRefs) ? normalized.ruleRefs : [],
        doctrineRefs: Array.isArray(normalized.doctrineRefs) ? normalized.doctrineRefs : [],
      };
      warnings.push(`Migrated artifact '${normalized.key}' from v1 to v2.`);
      continue;
    }

    throw new Error(`No migration path for artifact '${normalized.key}' from v${normalized.version} to v${targetVersion}.`);
  }

  return { artifact: normalized, warnings };
}

export function artifactReference(
  artifact: SkillArtifact<unknown> | undefined,
  key: ArtifactKey,
  fallbackProducer?: string,
): ArtifactReference {
  return {
    key,
    producer: artifact?.producer ?? fallbackProducer,
    version: artifact?.version ?? currentArtifactVersion(key),
  };
}
