import { loadDoctrineCards, loadRuleCards } from "./rules-loader.js";
import type {
  ArtifactStore,
  CapabilitySnapshot,
  ExecutionPlane,
  OkxCommandIntent,
  OrderPlanStep,
  PolicyDecision,
  PolicyPhase,
  PolicyCapabilityGap,
  PortfolioRiskProfile,
  PortfolioSnapshot,
  RiskBudget,
  ScenarioMatrix,
  SkillProposal,
  TradeThesis,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

interface PolicyLimits {
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

interface RiskOrderSlice {
  instId: string;
  symbol: string;
  module: string;
  side: "buy" | "sell";
  reduceOnly: boolean;
  notionalUsd: number;
}

export interface EvaluatePolicyInput {
  phase: PolicyPhase;
  artifacts: ArtifactStore;
  proposal: SkillProposal;
  plane: ExecutionPlane;
  approvalProvided: boolean;
  executeRequested: boolean;
  allowedModules?: string[];
  capabilitySnapshot?: CapabilitySnapshot;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envSymbolList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function asObject(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}

function asObjectArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asObject(entry))
      .filter((entry): entry is JsonRecord => Boolean(entry));
  }

  const objectValue = asObject(value);
  if (!objectValue) {
    return [];
  }

  const data = objectValue.data;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((entry) => asObject(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.replace(/,/g, "").trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function inferModuleFromCommand(command: string): string {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] === "okx" && tokens[1]) {
    return tokens[1];
  }
  return "unknown";
}

function inferWriteFromCommand(command: string, module: string): boolean {
  if (["swap", "option", "spot", "margin", "subaccount"].includes(module)) {
    return true;
  }
  return /\b(order|place|create|cancel|close|open)\b/i.test(command);
}

function normalizeProposalIntents(proposal: SkillProposal): OkxCommandIntent[] {
  if (proposal.intents && proposal.intents.length > 0) {
    return proposal.intents;
  }

  return (proposal.cliIntents ?? []).map((command, index) => {
    const module = inferModuleFromCommand(command);
    const requiresWrite = inferWriteFromCommand(command, module);
    return {
      intentId: `${proposal.name}:${index}`,
      stepIndex: index,
      safeToRetry: !requiresWrite,
      command,
      args: command.trim().split(/\s+/),
      module,
      requiresWrite,
      reason: "Migrated from legacy cliIntents string command.",
    };
  });
}

function symbolFromInstId(instId: string): string {
  return instId.split("-")[0] ?? instId;
}

function normalizeBool(value: string | true | undefined): boolean {
  if (value === true) {
    return true;
  }
  return value === "true" || value === "1" || value?.toLowerCase() === "yes";
}

function parseCommandFlags(args: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
      continue;
    }
    flags.set(key, true);
  }
  return flags;
}

function parseOrderSlicesFromOrderPlan(orderPlan: OrderPlanStep[] | undefined): RiskOrderSlice[] {
  if (!orderPlan || orderPlan.length === 0) {
    return [];
  }

  const slices: RiskOrderSlice[] = [];
  for (const step of orderPlan) {
    if (step.kind === "swap-place-order") {
      const instId = step.params.instId;
      const symbol = (step.symbol || symbolFromInstId(instId)).toUpperCase();
      const notionalUsd =
        step.targetNotionalUsd > 0
          ? step.targetNotionalUsd
          : Math.max(0, (toNumber(step.params.sz) ?? 0) * (toNumber(step.params.px) ?? step.referencePx));
      if (notionalUsd <= 0) {
        continue;
      }

      slices.push({
        instId,
        symbol,
        module: "swap",
        side: step.params.side,
        reduceOnly: step.params.reduceOnly === true,
        notionalUsd,
      });
      continue;
    }

    if (step.kind === "option-place-order") {
      const instId = step.params.instId;
      const symbol = (step.symbol || symbolFromInstId(instId)).toUpperCase();
      const notionalUsd =
        step.targetPremiumUsd > 0
          ? step.targetPremiumUsd
          : Math.max(0, (toNumber(step.params.sz) ?? 0) * (toNumber(step.params.px) ?? step.referencePx));
      if (notionalUsd <= 0) {
        continue;
      }

      slices.push({
        instId,
        symbol,
        module: "option",
        side: step.params.side,
        reduceOnly: false,
        notionalUsd,
      });
    }
  }

  return slices;
}

function parseOrderSlicesFromIntents(intents: OkxCommandIntent[]): RiskOrderSlice[] {
  const slices: RiskOrderSlice[] = [];
  for (const intent of intents) {
    if (!intent.requiresWrite) {
      continue;
    }

    if (!["swap", "option", "spot"].includes(intent.module)) {
      continue;
    }

    const flags = parseCommandFlags(intent.args);
    const instIdRaw = flags.get("instId");
    const sideRaw = flags.get("side");
    const szRaw = flags.get("sz");
    const pxRaw = flags.get("px");
    const reduceOnlyRaw = flags.get("reduceOnly");
    if (typeof instIdRaw !== "string" || typeof sideRaw !== "string" || typeof szRaw !== "string") {
      continue;
    }

    const px = toNumber(typeof pxRaw === "string" ? pxRaw : undefined);
    const sz = toNumber(szRaw) ?? 0;
    const symbol = symbolFromInstId(instIdRaw).toUpperCase();
    slices.push({
      instId: instIdRaw,
      symbol,
      module: intent.module,
      side: sideRaw === "buy" ? "buy" : "sell",
      reduceOnly: normalizeBool(typeof reduceOnlyRaw === "string" ? reduceOnlyRaw : reduceOnlyRaw),
      notionalUsd: sz > 0 && px && px > 0 ? sz * px : 0,
    });
  }

  return slices;
}

function extractBalanceRows(payload: unknown): JsonRecord[] {
  const topRows = asObjectArray(payload);
  const details = topRows.flatMap((row) => {
    const detail = row.details;
    if (!Array.isArray(detail)) {
      return [];
    }

    return detail
      .map((entry) => asObject(entry))
      .filter((entry): entry is JsonRecord => Boolean(entry));
  });

  return details.length > 0 ? details : topRows;
}

function extractAvailableUsd(balancePayload: unknown): number | null {
  const rows = extractBalanceRows(balancePayload);
  let total = 0;
  let hasValue = false;

  for (const row of rows) {
    const usdEq = toNumber(row.usdEq) ?? toNumber(row.eqUsd);
    if (usdEq !== undefined) {
      total += Math.max(0, usdEq);
      hasValue = true;
      continue;
    }

    const ccy = typeof row.ccy === "string" ? row.ccy.toUpperCase() : "";
    const avail = toNumber(row.availBal) ?? toNumber(row.availEq);
    if ((ccy === "USDT" || ccy === "USD") && avail !== undefined) {
      total += Math.max(0, avail);
      hasValue = true;
    }
  }

  return hasValue ? total : null;
}

function portfolioSnapshotFromArtifacts(artifacts: ArtifactStore): PortfolioSnapshot {
  const direct = artifacts.get<PortfolioSnapshot>("portfolio.snapshot")?.data;
  if (direct && typeof direct === "object" && "source" in (direct as object)) {
    const snapshot = direct as PortfolioSnapshot;
    return {
      source: snapshot.source,
      symbols: Array.isArray(snapshot.symbols) ? snapshot.symbols : [],
      drawdownTarget: typeof snapshot.drawdownTarget === "string" ? snapshot.drawdownTarget : "4%",
      balance: snapshot.balance,
      positions: snapshot.positions,
      feeRates: snapshot.feeRates,
      bills: snapshot.bills,
      commands: Array.isArray(snapshot.commands) ? snapshot.commands : [],
      errors: Array.isArray(snapshot.errors) ? snapshot.errors : [],
      accountEquity: snapshot.accountEquity ?? 0,
      availableUsd:
        snapshot.availableUsd !== undefined
          ? snapshot.availableUsd
          : extractAvailableUsd(snapshot.balance),
    };
  }

  const legacy = direct as JsonRecord | undefined;
  return {
    source: legacy?.source === "okx-cli" ? "okx-cli" : "fallback",
    symbols: [],
    drawdownTarget: "4%",
    balance: legacy?.balance,
    positions: legacy?.positions,
    feeRates: legacy?.feeRates,
    bills: legacy?.bills,
    commands: Array.isArray(legacy?.commands) ? (legacy?.commands as string[]) : [],
    errors: Array.isArray(legacy?.errors) ? (legacy?.errors as string[]) : [],
    accountEquity: toNumber(legacy?.totalEq) ?? toNumber(legacy?.equity) ?? 0,
    availableUsd: extractAvailableUsd(legacy?.balance),
  };
}

function riskProfileFromArtifacts(artifacts: ArtifactStore): PortfolioRiskProfile | undefined {
  return artifacts.get<PortfolioRiskProfile>("portfolio.risk-profile")?.data;
}

function tradeThesisFromArtifacts(artifacts: ArtifactStore): TradeThesis | undefined {
  return artifacts.get<TradeThesis>("trade.thesis")?.data;
}

function scenarioMatrixFromProposal(
  proposal: SkillProposal,
): ScenarioMatrix | undefined {
  return proposal.scenarioMatrix;
}

function avgLeverage(profile: PortfolioRiskProfile | undefined): number {
  if (!profile || profile.leverageHotspots.length === 0) {
    return 0;
  }

  const total = profile.leverageHotspots.reduce((sum, hotspot) => sum + hotspot.leverage, 0);
  return total / profile.leverageHotspots.length;
}

async function computePolicyLimits(
  artifacts: ArtifactStore,
  thesis: TradeThesis | undefined,
): Promise<{ limits: PolicyLimits; ruleRefs: string[]; doctrineRefs: string[] }> {
  const rules = await loadRuleCards();
  const doctrines = await loadDoctrineCards();
  const snapshot = portfolioSnapshotFromArtifacts(artifacts);
  const profile = riskProfileFromArtifacts(artifacts);
  const marketRegime = artifacts.get<{ marketVolatility?: number | null }>("market.regime")?.data;
  const accountEquity = snapshot.accountEquity > 0 ? snapshot.accountEquity : envNumber("TRADEMESH_ACCOUNT_EQUITY_FALLBACK", 50_000);
  const marketVolatility =
    typeof marketRegime?.marketVolatility === "number"
      ? marketRegime.marketVolatility
      : thesis?.riskBudget.maxTotalExposureUsd
        ? null
        : null;
  const ruleRefs: string[] = [];

  let limits: PolicyLimits = {
    maxSingleOrderUsd: thesis?.riskBudget.maxSingleOrderUsd ?? envNumber("TRADEMESH_MAX_SINGLE_ORDER_USD", accountEquity * 0.02),
    maxTotalOrderUsd: envNumber("TRADEMESH_MAX_TOTAL_ORDER_USD", accountEquity * 0.06),
    maxTotalExposureUsd: thesis?.riskBudget.maxTotalExposureUsd ?? envNumber("TRADEMESH_MAX_TOTAL_EXPOSURE_USD", accountEquity * 3),
    maxMarginUseUsd: thesis?.riskBudget.maxMarginUseUsd ?? envNumber("TRADEMESH_MAX_MARGIN_USE_USD", accountEquity * 0.15),
    maxPremiumSpendUsd: thesis?.riskBudget.maxPremiumSpendUsd ?? envNumber("TRADEMESH_MAX_PREMIUM_SPEND_USD", accountEquity * 0.02),
    maxCorrelationBucketPct:
      thesis?.riskBudget.maxCorrelationBucketPct ?? envNumber("TRADEMESH_MAX_CORRELATION_BUCKET_PCT", 40),
    marketVolatility: typeof marketRegime?.marketVolatility === "number" ? marketRegime.marketVolatility : null,
    volatilityAdjusted: false,
    leverageAdjusted: false,
  };

  for (const rule of rules.filter((entry) => entry.appliesTo.includes("policy-gate") || entry.appliesTo.includes("trade-thesis"))) {
    if (rule.id === "max-single-order" && typeof rule.action.multiplier === "number") {
      limits.maxSingleOrderUsd = accountEquity * Number(rule.action.multiplier);
      ruleRefs.push(rule.id);
    }

    if (rule.id === "max-total-exposure" && typeof rule.action.multiplier === "number") {
      limits.maxTotalExposureUsd = accountEquity * Number(rule.action.multiplier);
      ruleRefs.push(rule.id);
    }

    if (rule.id === "max-symbol-concentration" && typeof rule.action.value === "number") {
      limits.maxCorrelationBucketPct = Number(rule.action.value);
      ruleRefs.push(rule.id);
    }

    if (
      rule.id === "volatility-adjustment" &&
      limits.marketVolatility !== null &&
      typeof rule.condition.threshold === "number" &&
      typeof rule.action.factor === "number" &&
      limits.marketVolatility > Number(rule.condition.threshold)
    ) {
      limits.maxSingleOrderUsd *= Number(rule.action.factor);
      limits.volatilityAdjusted = true;
      ruleRefs.push(rule.id);
    }

    if (
      rule.id === "leverage-tightening" &&
      typeof rule.condition.threshold === "number" &&
      typeof rule.action.factor === "number" &&
      avgLeverage(profile) > Number(rule.condition.threshold)
    ) {
      limits.maxTotalExposureUsd *= Number(rule.action.factor);
      limits.leverageAdjusted = true;
      ruleRefs.push(rule.id);
    }
  }

  const doctrineRefs = doctrines
    .filter((doctrine) => ruleRefs.some((ruleId) => doctrine.linkedRuleIds.includes(ruleId)))
    .map((doctrine) => doctrine.id);

  return { limits, ruleRefs: [...new Set(ruleRefs)], doctrineRefs: [...new Set(doctrineRefs)] };
}

function decision(
  input: EvaluatePolicyInput,
  proposal: SkillProposal,
  outcome: PolicyDecision["outcome"],
  reasons: string[],
  extras: {
    ruleRefs?: string[];
    doctrineRefs?: string[];
    breachFlags?: string[];
    budgetSnapshot?: PolicyDecision["budgetSnapshot"];
    capabilityGaps?: PolicyCapabilityGap[];
  } = {},
): PolicyDecision {
  return {
    outcome,
    reasons,
    proposal: proposal.name,
    plane: input.plane,
    executeRequested: input.executeRequested,
    approvalProvided: input.approvalProvided,
    evaluatedAt: new Date().toISOString(),
    phase: input.phase,
    ruleRefs: extras.ruleRefs ?? [],
    doctrineRefs: extras.doctrineRefs ?? [],
    breachFlags: extras.breachFlags ?? [],
    budgetSnapshot: extras.budgetSnapshot,
    capabilityGaps: extras.capabilityGaps ?? [],
  };
}

function defaultAllowedModules(plane: ExecutionPlane): string[] {
  return plane === "research" ? ["account", "market"] : ["account", "market", "swap", "option"];
}

function capabilityGap(
  id: string,
  severity: PolicyCapabilityGap["severity"],
  message: string,
  remedy: string,
): PolicyCapabilityGap {
  return {
    id,
    severity,
    message,
    remedy,
  };
}

function deriveCapabilityGaps(
  input: EvaluatePolicyInput,
): PolicyCapabilityGap[] {
  const snapshot = input.capabilitySnapshot;
  if (!snapshot) {
    return [];
  }

  const executeSeverity: PolicyCapabilityGap["severity"] =
    input.phase === "apply" && input.executeRequested ? "blocker" : "warn";
  const gaps: PolicyCapabilityGap[] = [];

  if (!snapshot.okxCliAvailable) {
    gaps.push(
      capabilityGap(
        "okx-cli",
        executeSeverity,
        "OKX CLI is not available on PATH; only preview-mode flows are safe right now.",
        "Install `okx` CLI and rerun `trademesh doctor`.",
      ),
    );
  }

  if (!snapshot.configExists) {
    gaps.push(
      capabilityGap(
        "okx-config",
        executeSeverity,
        "No executable OKX config was detected; runtime can plan, but cannot confidently execute.",
        "Create ~/.okx/config.toml or the local profiles/ files before execution.",
      ),
    );
  }

  if (input.plane === "demo" && !snapshot.demoProfileLikelyConfigured) {
    gaps.push(
      capabilityGap(
        "demo-profile",
        executeSeverity,
        "Demo plane is selected but no demo profile was detected.",
        "Configure a demo profile before running `apply --execute` on demo.",
      ),
    );
  }

  if (input.plane === "live" && !snapshot.liveProfileLikelyConfigured) {
    gaps.push(
      capabilityGap(
        "live-profile",
        executeSeverity,
        "Live plane is selected but no live profile was detected.",
        "Configure a live profile or switch back to the demo plane.",
      ),
    );
  }

  if (
    input.phase === "plan" &&
    input.plane !== "research" &&
    snapshot.recommendedPlane === "research"
  ) {
    gaps.push(
      capabilityGap(
        "recommended-plane",
        "info",
        "Current environment is better suited for research/demo preview than for executed writes.",
        "Use `apply --approve` without `--execute` first, then rerun doctor after environment setup.",
      ),
    );
  }

  return gaps;
}

export async function evaluatePolicy(input: EvaluatePolicyInput): Promise<PolicyDecision> {
  const intents = normalizeProposalIntents(input.proposal);
  const orderSlicesFromPlan = parseOrderSlicesFromOrderPlan(input.proposal.orderPlan);
  const orderSlices =
    orderSlicesFromPlan.length > 0 ? orderSlicesFromPlan : parseOrderSlicesFromIntents(intents);
  const writes = intents.some((intent) => intent.requiresWrite) || orderSlices.some((slice) => ["swap", "option", "spot"].includes(slice.module));
  const writeSlices = orderSlices.filter((slice) => slice.notionalUsd > 0);
  const proposal = input.proposal;
  const capabilityGaps = deriveCapabilityGaps(input);

  if (intents.length === 0 && (!proposal.orderPlan || proposal.orderPlan.length === 0)) {
    return decision(input, proposal, "blocked", [`proposal '${proposal.name}' does not contain executable intents`], {
      capabilityGaps,
    });
  }

  if (input.plane === "research" && writes) {
    return decision(input, proposal, "blocked", ["research plane blocks all write intents"], {
      capabilityGaps,
    });
  }

  const allowedModules = input.allowedModules ?? defaultAllowedModules(input.plane);
  const moduleViolations = intents
    .filter((intent) => !allowedModules.includes(intent.module))
    .map((intent) => `required module '${intent.module}' is not allowed in this plane`);
  if (moduleViolations.length > 0) {
    return decision(input, proposal, "blocked", moduleViolations, {
      capabilityGaps,
    });
  }

  const thesis = tradeThesisFromArtifacts(input.artifacts);
  const snapshot = portfolioSnapshotFromArtifacts(input.artifacts);
  const profile = riskProfileFromArtifacts(input.artifacts);
  const { limits, ruleRefs, doctrineRefs } = await computePolicyLimits(input.artifacts, thesis);
  const whitelistSymbols = envSymbolList("TRADEMESH_SYMBOL_WHITELIST", ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"]);
  const blacklistSymbols = envSymbolList("TRADEMESH_SYMBOL_BLACKLIST", ["LUNA", "UST", "FTT", "LUNA2"]);
  const breachFlags: string[] = [];

  if (thesis?.disciplineState === "restricted") {
    breachFlags.push("discipline-restricted");
    return decision(
      input,
      proposal,
      "blocked",
      ["discipline state is restricted and blocks execution"],
      {
        ruleRefs,
        doctrineRefs: [...new Set([...doctrineRefs, "discipline"])],
        breachFlags,
        budgetSnapshot: limits,
        capabilityGaps,
      },
    );
  }

  if (thesis?.disciplineState === "cooldown" && !input.approvalProvided) {
    breachFlags.push("discipline-cooldown");
    return decision(
      input,
      proposal,
      "require_approval",
      ["discipline cooldown requires explicit approval before continuing"],
      {
        ruleRefs,
        doctrineRefs: [...new Set([...doctrineRefs, "discipline"])],
        breachFlags,
        budgetSnapshot: limits,
        capabilityGaps,
      },
    );
  }

  const symbolViolations: string[] = [];
  for (const slice of writeSlices) {
    if (blacklistSymbols.includes(slice.symbol)) {
      symbolViolations.push(`symbol '${slice.symbol}' is blocked by blacklist`);
    }
    if (whitelistSymbols.length > 0 && !whitelistSymbols.includes(slice.symbol)) {
      symbolViolations.push(`symbol '${slice.symbol}' is not in whitelist`);
    }
  }
  if (symbolViolations.length > 0) {
    breachFlags.push("symbol-filter");
    return decision(input, proposal, "blocked", symbolViolations, {
      ruleRefs,
      doctrineRefs,
      breachFlags,
      budgetSnapshot: limits,
      capabilityGaps,
    });
  }

  const sizeViolations: string[] = [];
  const totalOrderNotionalUsd = writeSlices.reduce((sum, slice) => sum + slice.notionalUsd, 0);
  const totalPremiumUsd = writeSlices
    .filter((slice) => slice.module === "option")
    .reduce((sum, slice) => sum + slice.notionalUsd, 0);
  for (const slice of writeSlices) {
    if (slice.notionalUsd > limits.maxSingleOrderUsd) {
      sizeViolations.push(
        `${slice.instId} order notional ${slice.notionalUsd.toFixed(2)} exceeds single-order limit ${limits.maxSingleOrderUsd.toFixed(2)} USD`,
      );
    }
  }
  if (totalOrderNotionalUsd > limits.maxTotalOrderUsd) {
    sizeViolations.push(
      `aggregate order notional ${totalOrderNotionalUsd.toFixed(2)} exceeds total-order limit ${limits.maxTotalOrderUsd.toFixed(2)} USD`,
    );
  }
  if (totalPremiumUsd > limits.maxPremiumSpendUsd) {
    sizeViolations.push(
      `option premium spend ${totalPremiumUsd.toFixed(2)} exceeds premium budget ${limits.maxPremiumSpendUsd.toFixed(2)} USD`,
    );
  }
  if (sizeViolations.length > 0) {
    breachFlags.push("size-limit");
    return decision(input, proposal, "blocked", sizeViolations, {
      ruleRefs,
      doctrineRefs,
      breachFlags,
      budgetSnapshot: limits,
      capabilityGaps,
    });
  }

  const grossExposureUsd = profile?.concentration.grossUsd ?? 0;
  const projectedExposureUsd = grossExposureUsd + totalOrderNotionalUsd;
  const marginNeededUsd = writeSlices
    .filter((slice) => !slice.reduceOnly)
    .reduce((sum, slice) => sum + slice.notionalUsd * 0.12, 0);
  const accountViolations: string[] = [];
  if (snapshot.availableUsd !== null && marginNeededUsd > Math.min(snapshot.availableUsd, limits.maxMarginUseUsd)) {
    accountViolations.push(
      `estimated margin ${marginNeededUsd.toFixed(2)} exceeds usable budget ${Math.min(snapshot.availableUsd, limits.maxMarginUseUsd).toFixed(2)} USD`,
    );
  }
  if (projectedExposureUsd > limits.maxTotalExposureUsd) {
    accountViolations.push(
      `projected exposure ${projectedExposureUsd.toFixed(2)} exceeds cap ${limits.maxTotalExposureUsd.toFixed(2)} USD`,
    );
  }
  const topBucket = profile?.correlationBuckets?.[0];
  if (topBucket && topBucket.sharePct > limits.maxCorrelationBucketPct) {
    accountViolations.push(
      `correlation bucket ${topBucket.bucketId} at ${topBucket.sharePct.toFixed(1)}% exceeds ${limits.maxCorrelationBucketPct.toFixed(1)}%`,
    );
  }
  if (accountViolations.length > 0) {
    breachFlags.push("account-risk");
    return decision(input, proposal, "blocked", accountViolations, {
      ruleRefs,
      doctrineRefs,
      breachFlags,
      budgetSnapshot: limits,
      capabilityGaps,
    });
  }

  const scenarioMatrix = scenarioMatrixFromProposal(proposal);
  if (scenarioMatrix) {
    const scenarioBreaches = Object.values(scenarioMatrix)
      .flatMap((result) => result.breachFlags.map((flag) => `${result.scenario}:${flag}`));
    if (scenarioBreaches.length > 0) {
      breachFlags.push("scenario-breach");
      return decision(input, proposal, "blocked", [`scenario breaches detected: ${scenarioBreaches.join(", ")}`], {
        ruleRefs,
        doctrineRefs,
        breachFlags,
        budgetSnapshot: limits,
        capabilityGaps,
      });
    }
  }

  if (input.phase === "apply" && input.executeRequested) {
    if (!input.capabilitySnapshot?.okxCliAvailable) {
      breachFlags.push("capability-okx-cli");
      return decision(input, proposal, "blocked", ["okx CLI is not available on PATH, cannot execute intents"], {
        ruleRefs,
        doctrineRefs,
        breachFlags,
        budgetSnapshot: limits,
        capabilityGaps,
      });
    }
    if (!input.capabilitySnapshot.configExists) {
      breachFlags.push("capability-config");
      return decision(input, proposal, "blocked", ["profiles directory is missing, cannot execute intents"], {
        ruleRefs,
        doctrineRefs,
        breachFlags,
        budgetSnapshot: limits,
        capabilityGaps,
      });
    }
  }

  if (writes && input.plane !== "research" && !input.approvalProvided) {
    return decision(
      input,
      proposal,
      "require_approval",
      [
        input.plane === "live"
          ? "live write path requires explicit --approve"
          : "non-research write path requires explicit --approve",
      ],
      {
        ruleRefs,
        doctrineRefs,
        breachFlags,
        budgetSnapshot: limits,
        capabilityGaps,
      },
    );
  }

  return decision(
    input,
    proposal,
    "approved",
    [
      "policy gate approved this proposal",
      `order notional=${totalOrderNotionalUsd.toFixed(2)} singleLimit=${limits.maxSingleOrderUsd.toFixed(2)} totalLimit=${limits.maxTotalOrderUsd.toFixed(2)}`,
    ],
    {
      ruleRefs,
      doctrineRefs,
      breachFlags,
      budgetSnapshot: limits,
      capabilityGaps,
    },
  );
}
