import type {
  ExecutionPlane,
  GoalExecutePreference,
  GoalHedgeIntent,
  GoalIntake,
  GoalIntakeOverrides,
  GoalTimeHorizon,
  GoalValueSource,
  PortfolioRiskProfile,
} from "./types.js";

const DEFAULT_SYMBOLS = ["BTC"];
const IGNORED_SYMBOLS = new Set([
  "CLI",
  "OKX",
  "JSON",
  "DEMO",
  "LIVE",
  "HEDGE",
  "DRAWDOWN",
  "PROTECT",
  "DOWNSIDE",
  "FIRST",
  "WITH",
  "RISK",
  "PLAN",
  "APPLY",
  "EXECUTE",
  "ORDER",
  "MY",
  "THE",
  "AND",
  "BETA",
  "SWING",
  "POSITION",
  "INTRADAY",
]);

function normalizeGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, " ").toLowerCase();
}

function uniqueSymbols(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function parseSymbolsFromGoal(goal: string): string[] {
  const matches = goal.toUpperCase().match(/\b[A-Z]{2,10}\b/g) ?? [];
  return uniqueSymbols(matches.filter((symbol) => !IGNORED_SYMBOLS.has(symbol)));
}

function parseDrawdownFromGoal(goal: string): number | null {
  const matches = [...goal.matchAll(/(\d+(\.\d+)?)\s*%/g)];
  const finalMatch = matches.at(-1);
  if (!finalMatch) {
    return null;
  }

  const value = Number(finalMatch[1]);
  return Number.isFinite(value) ? value : null;
}

function parseIntentFromGoal(goal: string): GoalHedgeIntent {
  const normalized = normalizeGoal(goal);
  if (/\b(reduce beta|beta neutral|beta hedge)\b/.test(normalized)) {
    return "reduce_beta";
  }
  if (/\b(de-risk|derisk|cut risk|reduce risk|降低风险|去风险)\b/.test(normalized)) {
    return "de_risk";
  }
  if (/\b(hedge|protect|downside|drawdown|tail risk|对冲|保护|回撤)\b/.test(normalized)) {
    return "protect_downside";
  }
  return "unspecified";
}

function parseHorizonFromGoal(goal: string): GoalTimeHorizon {
  const normalized = normalizeGoal(goal);
  if (/\b(intraday|day trade|scalp|today)\b/.test(normalized)) {
    return "intraday";
  }
  if (/\b(swing|this week|next week)\b/.test(normalized)) {
    return "swing";
  }
  if (/\b(position|long term|long-term|multi week|multi-week)\b/.test(normalized)) {
    return "position";
  }
  return "unspecified";
}

function parsePlanePreference(goal: string): GoalIntake["planePreference"] {
  if (/\b(live|实盘)\b/i.test(goal)) {
    return "live";
  }
  if (/\b(demo|模拟|演练)\b/i.test(goal)) {
    return "demo";
  }
  if (/\b(research|研究)\b/i.test(goal)) {
    return "research";
  }
  return "unspecified";
}

function inferredProfileSymbol(profile?: PortfolioRiskProfile): string | null {
  if (!profile) {
    return null;
  }
  if (profile.concentration.topSymbol && profile.concentration.topSymbol !== "n/a") {
    return profile.concentration.topSymbol.toUpperCase();
  }
  if (profile.leverageHotspots.length > 0) {
    return profile.leverageHotspots[0]?.symbol?.toUpperCase() ?? null;
  }
  if (profile.correlationBuckets.length > 0) {
    return profile.correlationBuckets[0]?.symbols[0]?.toUpperCase() ?? null;
  }
  return null;
}

function sanitizedOverrideSymbols(overrides: GoalIntakeOverrides | undefined, runtimeInput: Record<string, unknown>): string[] {
  if (Array.isArray(overrides?.symbols) && overrides.symbols.length > 0) {
    return uniqueSymbols(overrides.symbols);
  }

  const initialSymbols = runtimeInput.initialSymbols;
  if (Array.isArray(initialSymbols) && initialSymbols.length > 0) {
    return uniqueSymbols(initialSymbols.filter((value): value is string => typeof value === "string"));
  }

  return [];
}

function roundedDrawdown(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function goalExecutePreference(
  plane: ExecutionPlane,
  overrides: GoalIntakeOverrides | undefined,
): GoalExecutePreference {
  if (overrides?.executePreference) {
    return overrides.executePreference;
  }
  if (plane === "demo" || plane === "live") {
    return "plan_only";
  }
  return "plan_only";
}

export function formatDrawdownPct(value: number | null): string {
  return `${roundedDrawdown(value ?? 4) ?? 4}%`;
}

export function resolveGoalIntake(input: {
  goal: string;
  plane: ExecutionPlane;
  runtimeInput: Record<string, unknown>;
  riskProfile?: PortfolioRiskProfile;
}): GoalIntake {
  const overrides = input.runtimeInput.goalOverrides as GoalIntakeOverrides | undefined;
  const warnings: string[] = [];
  const parsedSymbols = parseSymbolsFromGoal(input.goal);
  const overrideSymbols = sanitizedOverrideSymbols(overrides, input.runtimeInput);
  let symbolsSource: GoalValueSource = "default";
  let symbols = DEFAULT_SYMBOLS;

  if (overrideSymbols.length > 0) {
    symbolsSource = "cli_flag";
    symbols = overrideSymbols;
  } else if (parsedSymbols.length > 0) {
    symbolsSource = "goal_parse";
    symbols = parsedSymbols;
  } else {
    const inferred = inferredProfileSymbol(input.riskProfile);
    if (inferred) {
      symbolsSource = "portfolio_inference";
      symbols = [inferred];
    } else {
      warnings.push("Symbol defaulted to BTC because neither goal parsing nor portfolio inference found a stronger candidate.");
    }
  }

  const parsedDrawdown = parseDrawdownFromGoal(input.goal);
  const targetDrawdownPct = roundedDrawdown(overrides?.targetDrawdownPct ?? parsedDrawdown ?? 4);
  const drawdownSource: GoalIntake["sources"]["targetDrawdownPct"] =
    overrides?.targetDrawdownPct !== undefined ? "cli_flag" : parsedDrawdown !== null ? "goal_parse" : "default";
  if (drawdownSource === "default") {
    warnings.push("Drawdown target defaulted to 4%.");
  }

  const parsedIntent = parseIntentFromGoal(input.goal);
  const hedgeIntent = overrides?.hedgeIntent ?? (parsedIntent === "unspecified" ? "protect_downside" : parsedIntent);
  const intentSource: GoalIntake["sources"]["hedgeIntent"] =
    overrides?.hedgeIntent !== undefined ? "cli_flag" : parsedIntent !== "unspecified" ? "goal_parse" : "default";

  const parsedHorizon = parseHorizonFromGoal(input.goal);
  const timeHorizon = overrides?.timeHorizon ?? (parsedHorizon === "unspecified" ? "swing" : parsedHorizon);
  const horizonSource: GoalIntake["sources"]["timeHorizon"] =
    overrides?.timeHorizon !== undefined ? "cli_flag" : parsedHorizon !== "unspecified" ? "goal_parse" : "default";

  if (symbolsSource === "portfolio_inference") {
    warnings.push(`Symbol inferred from portfolio concentration: ${symbols.join(", ")}.`);
  }

  return {
    rawGoal: input.goal,
    normalizedGoal: normalizeGoal(input.goal),
    symbols,
    targetDrawdownPct,
    hedgeIntent,
    timeHorizon,
    planePreference: parsePlanePreference(input.goal),
    executePreference: goalExecutePreference(input.plane, overrides),
    sources: {
      symbols: symbolsSource,
      targetDrawdownPct: drawdownSource,
      hedgeIntent: intentSource,
      timeHorizon: horizonSource,
    },
    warnings,
  };
}
