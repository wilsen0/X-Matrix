import { putArtifact } from "../../runtime/artifacts.js";
import { loadDoctrineCards, loadRuleCards } from "../../runtime/rules-loader.js";
import type {
  GoalIntake,
  MarketRegime,
  PortfolioRiskProfile,
  PortfolioSnapshot,
  SkillContext,
  SkillOutput,
  TradeThesis,
} from "../../runtime/types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function deriveDisciplineState(profile: PortfolioRiskProfile, regime: MarketRegime): TradeThesis["disciplineState"] {
  const highestLeverage = profile.leverageHotspots[0]?.leverage ?? 0;
  if (highestLeverage >= 8 && regime.tailRiskState === "stress") {
    return "restricted";
  }

  if (highestLeverage >= 5 || profile.feeDrag.recentFeePaidUsd >= 50 || regime.volState === "stress") {
    return "cooldown";
  }

  return "normal";
}

function deriveHedgeBias(
  profile: PortfolioRiskProfile,
  regime: MarketRegime,
  disciplineState: TradeThesis["disciplineState"],
): TradeThesis["hedgeBias"] {
  if (disciplineState === "restricted" || regime.tailRiskState === "stress") {
    return "de-risk";
  }

  if (regime.volState === "stress" || regime.volState === "elevated") {
    return "protective-put";
  }

  if (profile.concentration.topSharePct >= 55 && regime.volState !== "compressed") {
    return "collar";
  }

  return "perp";
}

function derivePreferredStrategies(bias: TradeThesis["hedgeBias"], regime: MarketRegime): string[] {
  const fromBias =
    bias === "perp"
      ? ["perp-short", "protective-put", "collar", "de-risk"]
      : bias === "protective-put"
        ? ["protective-put", "collar", "perp-short", "de-risk"]
        : bias === "collar"
          ? ["collar", "protective-put", "perp-short", "de-risk"]
          : ["de-risk", "protective-put", "collar", "perp-short"];

  if (regime.fundingState === "longs-paying") {
    return [...new Set(["protective-put", "collar", ...fromBias])];
  }

  return fromBias;
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const goalIntake = context.artifacts.get<GoalIntake>("goal.intake")?.data;
  const portfolioSnapshot = context.artifacts.require<PortfolioSnapshot>("portfolio.snapshot").data;
  const profile = context.artifacts.require<PortfolioRiskProfile>("portfolio.risk-profile").data;
  const regime = context.artifacts.require<MarketRegime>("market.regime").data;
  const ruleCards = await loadRuleCards();
  const doctrineCards = await loadDoctrineCards();

  const ruleRefs = ruleCards
    .filter((card) =>
      card.appliesTo.some((target) => ["trade-thesis", "policy-gate", "hedge-planner"].includes(target)),
    )
    .map((card) => card.id);
  const doctrineRefs = doctrineCards.map((card) => card.id);
  const disciplineState = deriveDisciplineState(profile, regime);
  const hedgeBias = deriveHedgeBias(profile, regime, disciplineState);
  const conviction = clamp(
    Math.round(
      regime.conviction * 0.55 +
        clamp(profile.concentration.topSharePct, 0, 100) * 0.2 +
        clamp(Math.abs(profile.directionalExposure.netUsd) / Math.max(profile.concentration.grossUsd || 1, 1), 0, 1) *
          25,
    ),
    0,
    100,
  );
  const equityBase = Math.max(portfolioSnapshot.accountEquity, profile.concentration.grossUsd, 10_000);
  const volatilityPenalty =
    regime.volState === "stress" ? 0.55 : regime.volState === "elevated" ? 0.72 : regime.volState === "compressed" ? 1.1 : 1;
  const riskBudget = {
    maxSingleOrderUsd: roundUsd(equityBase * 0.08 * volatilityPenalty),
    maxPremiumSpendUsd: roundUsd(equityBase * (regime.tailRiskState === "stress" ? 0.03 : 0.015)),
    maxMarginUseUsd: roundUsd(equityBase * 0.18 * volatilityPenalty),
    maxCorrelationBucketPct: regime.tailRiskState === "stress" ? 35 : 45,
    maxTotalExposureUsd: roundUsd(equityBase * (disciplineState === "restricted" ? 1.1 : 1.8) * volatilityPenalty),
  };
  const preferredStrategies = derivePreferredStrategies(hedgeBias, regime);
  const decisionNotes = [
    `Directional regime ${regime.directionalRegime} with conviction ${conviction}.`,
    `Volatility state ${regime.volState}, tail risk ${regime.tailRiskState}, funding ${regime.fundingState}.`,
    `Discipline state ${disciplineState} from leverage/fee drag profile.`,
    `Preferred hedge bias ${hedgeBias}.`,
  ];

  const thesis: TradeThesis = {
    directionalRegime: regime.directionalRegime,
    volState: regime.volState,
    tailRiskState: regime.tailRiskState,
    hedgeBias,
    conviction,
    riskBudget,
    disciplineState,
    preferredStrategies,
    decisionNotes,
    ruleRefs,
    doctrineRefs,
  };

  putArtifact(context.artifacts, {
    key: "trade.thesis",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: thesis,
    ruleRefs,
    doctrineRefs,
  });

  return {
    skill: "trade-thesis",
    stage: "planner",
    goal: context.goal,
    summary: "Synthesize a single canonical trade thesis so downstream skills stop re-deriving local heuristics.",
    facts: [
      ...(goalIntake
        ? [`Goal intake: symbols=${goalIntake.symbols.join(", ")} intent=${goalIntake.hedgeIntent} horizon=${goalIntake.timeHorizon}.`]
        : []),
      `Thesis bias: ${hedgeBias}.`,
      `Discipline state: ${disciplineState}.`,
      `Risk budget: single=${riskBudget.maxSingleOrderUsd.toFixed(0)} premium=${riskBudget.maxPremiumSpendUsd.toFixed(0)} margin=${riskBudget.maxMarginUseUsd.toFixed(0)}.`,
    ],
    constraints: {
      requiredModules: ["account", "market"],
      conviction,
      hedgeBias,
      disciplineState,
      preferredStrategies,
    },
    proposal: [],
    risk: {
      score: regime.tailRiskState === "stress" ? 0.68 : regime.volState === "elevated" ? 0.42 : 0.24,
      maxLoss: "Thesis only; no execution path is materialized here.",
      needsApproval: false,
      reasons: decisionNotes,
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["account", "market"],
    },
    handoff: "hedge-planner",
    handoffReason: "The canonical trade thesis is ready for proposal generation.",
    producedArtifacts: ["trade.thesis"],
    consumedArtifacts: ["portfolio.snapshot", "portfolio.risk-profile", "market.regime"],
    ruleRefs,
    doctrineRefs,
    metadata: {
      thesis,
      goalIntake: goalIntake ?? null,
    },
    timestamp: new Date().toISOString(),
  };
}
