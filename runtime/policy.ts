import { readAccountSnapshot } from "./okx.js";
import type {
  ExecutionPlane,
  OkxCommandIntent,
  OrderPlanStep,
  PolicyDecision,
  RunRecord,
  SkillProposal,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

interface ApplyPolicyInput {
  record: RunRecord;
  proposal: SkillProposal;
  plane: ExecutionPlane;
  approvalProvided: boolean;
  executeRequested: boolean;
}

interface PolicyLimits {
  maxSingleOrderNotionalUsd: number;
  maxTotalOrderNotionalUsd: number;
  maxTotalExposureUsd: number;
  initialMarginRate: number;
  whitelistSymbols: string[];
  blacklistSymbols: string[];
}

interface RiskOrderSlice {
  instId: string;
  symbol: string;
  module: string;
  side: "buy" | "sell";
  reduceOnly: boolean;
  notionalUsd: number;
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

function getPolicyLimits(): PolicyLimits {
  return {
    maxSingleOrderNotionalUsd: envNumber("TRADEMESH_MAX_SINGLE_ORDER_USD", 50_000),
    maxTotalOrderNotionalUsd: envNumber("TRADEMESH_MAX_TOTAL_ORDER_USD", 150_000),
    maxTotalExposureUsd: envNumber("TRADEMESH_MAX_TOTAL_EXPOSURE_USD", 300_000),
    initialMarginRate: envNumber("TRADEMESH_INITIAL_MARGIN_RATE", 0.12),
    whitelistSymbols: envSymbolList(
      "TRADEMESH_SYMBOL_WHITELIST",
      ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"],
    ),
    blacklistSymbols: envSymbolList("TRADEMESH_SYMBOL_BLACKLIST", ["LUNA", "UST", "FTT"]),
  };
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

function toString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
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

  return (proposal.cliIntents ?? []).map((command) => {
    const module = inferModuleFromCommand(command);
    return {
      command,
      args: command.trim().split(/\s+/),
      module,
      requiresWrite: inferWriteFromCommand(command, module),
      reason: "Migrated from legacy cliIntents string command.",
    };
  });
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

function normalizeBool(value: string | true | undefined): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }

  return value === "true" || value === "1" || value.toLowerCase() === "yes";
}

function symbolFromInstId(instId: string): string {
  return instId.split("-")[0] ?? instId;
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

    if (step.kind !== "option-place-order") {
      continue;
    }

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

  return slices;
}

function parseOrderSlicesFromIntents(intents: OkxCommandIntent[]): RiskOrderSlice[] {
  const slices: RiskOrderSlice[] = [];
  for (const intent of intents) {
    if (!intent.requiresWrite) {
      continue;
    }

    if (intent.module !== "swap" && intent.module !== "option" && intent.module !== "spot") {
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

    const side = sideRaw === "buy" ? "buy" : "sell";
    const symbol = symbolFromInstId(instIdRaw).toUpperCase();
    const sz = toNumber(szRaw) ?? 0;
    const px = toNumber(typeof pxRaw === "string" ? pxRaw : undefined);
    const notionalUsd = sz > 0 && px && px > 0 ? sz * px : 0;
    slices.push({
      instId: instIdRaw,
      symbol,
      module: intent.module,
      side,
      reduceOnly: normalizeBool(typeof reduceOnlyRaw === "string" ? reduceOnlyRaw : reduceOnlyRaw),
      notionalUsd,
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

    const ccy = toString(row.ccy)?.toUpperCase();
    const avail = toNumber(row.availBal) ?? toNumber(row.availEq);
    if ((ccy === "USDT" || ccy === "USD") && avail !== undefined) {
      total += Math.max(0, avail);
      hasValue = true;
    }
  }

  return hasValue ? total : null;
}

function extractGrossExposureUsd(positionsPayload: unknown): number {
  const rows = asObjectArray(positionsPayload);
  let grossUsd = 0;

  for (const row of rows) {
    const position = Math.abs(toNumber(row.pos) ?? toNumber(row.sz) ?? 0);
    const notional =
      Math.abs(
        toNumber(row.notionalUsd) ??
          toNumber(row.notional) ??
          toNumber(row.posUsd) ??
          position * (toNumber(row.markPx) ?? toNumber(row.last) ?? 0),
      ) || 0;

    if (notional > 0) {
      grossUsd += notional;
    }
  }

  return grossUsd;
}

function extractOpenPositionCount(positionsPayload: unknown): number {
  const rows = asObjectArray(positionsPayload);
  return rows.filter((row) => Math.abs(toNumber(row.pos) ?? toNumber(row.sz) ?? 0) > 0).length;
}

function decision(
  outcome: PolicyDecision["outcome"],
  reasons: string[],
  proposal: SkillProposal,
  plane: ExecutionPlane,
  executeRequested: boolean,
  approvalProvided: boolean,
): PolicyDecision {
  return {
    outcome,
    reasons,
    proposal: proposal.name,
    plane,
    executeRequested,
    approvalProvided,
    evaluatedAt: new Date().toISOString(),
  };
}

export function evaluateApplyPolicy(input: ApplyPolicyInput): PolicyDecision {
  const { record, proposal, plane, approvalProvided, executeRequested } = input;
  const limits = getPolicyLimits();
  const intents = normalizeProposalIntents(proposal);
  const writes = intents.some((intent) => intent.requiresWrite);

  if (intents.length === 0) {
    return decision(
      "blocked",
      [`proposal '${proposal.name}' does not contain executable intents`],
      proposal,
      plane,
      executeRequested,
      approvalProvided,
    );
  }

  if (plane === "research" && writes) {
    return decision(
      "blocked",
      ["research plane blocks all write intents"],
      proposal,
      plane,
      executeRequested,
      approvalProvided,
    );
  }

  const moduleViolations = intents
    .filter((intent) => !record.permissions.allowedModules.includes(intent.module))
    .map((intent) => `required module '${intent.module}' is not allowed in this plane`);
  if (moduleViolations.length > 0) {
    return decision("blocked", moduleViolations, proposal, plane, executeRequested, approvalProvided);
  }

  const orderSlicesFromPlan = parseOrderSlicesFromOrderPlan(proposal.orderPlan);
  const orderSlices =
    orderSlicesFromPlan.length > 0 ? orderSlicesFromPlan : parseOrderSlicesFromIntents(intents);
  const writeSlices = orderSlices.filter((slice) => slice.notionalUsd > 0);

  const symbolViolations: string[] = [];
  for (const slice of writeSlices) {
    if (limits.blacklistSymbols.includes(slice.symbol)) {
      symbolViolations.push(`symbol '${slice.symbol}' is blocked by blacklist`);
    }
    if (
      limits.whitelistSymbols.length > 0 &&
      !limits.whitelistSymbols.includes(slice.symbol)
    ) {
      symbolViolations.push(`symbol '${slice.symbol}' is not in whitelist`);
    }
  }
  if (symbolViolations.length > 0) {
    return decision("blocked", symbolViolations, proposal, plane, executeRequested, approvalProvided);
  }

  const sizeViolations: string[] = [];
  const totalOrderNotionalUsd = writeSlices.reduce((sum, slice) => sum + slice.notionalUsd, 0);
  for (const slice of writeSlices) {
    if (slice.notionalUsd > limits.maxSingleOrderNotionalUsd) {
      sizeViolations.push(
        `${slice.instId} order notional ${slice.notionalUsd.toFixed(2)} exceeds single-order limit ${limits.maxSingleOrderNotionalUsd.toFixed(2)} USD`,
      );
    }
  }
  if (totalOrderNotionalUsd > limits.maxTotalOrderNotionalUsd) {
    sizeViolations.push(
      `aggregate order notional ${totalOrderNotionalUsd.toFixed(2)} exceeds total-order limit ${limits.maxTotalOrderNotionalUsd.toFixed(2)} USD`,
    );
  }
  if (sizeViolations.length > 0) {
    return decision("blocked", sizeViolations, proposal, plane, executeRequested, approvalProvided);
  }

  if (executeRequested && !record.capabilitySnapshot.okxCliAvailable) {
    return decision(
      "blocked",
      ["okx CLI is not available on PATH, cannot execute intents"],
      proposal,
      plane,
      executeRequested,
      approvalProvided,
    );
  }

  if (executeRequested && !record.capabilitySnapshot.configExists) {
    return decision(
      "blocked",
      ["profiles directory is missing, cannot execute intents"],
      proposal,
      plane,
      executeRequested,
      approvalProvided,
    );
  }

  if (executeRequested && plane === "demo" && !record.capabilitySnapshot.demoProfileLikelyConfigured) {
    return decision(
      "blocked",
      ["demo profile is missing (profiles/demo.toml)"],
      proposal,
      plane,
      executeRequested,
      approvalProvided,
    );
  }

  if (executeRequested && plane === "live" && !record.capabilitySnapshot.liveProfileLikelyConfigured) {
    return decision(
      "blocked",
      ["live profile is missing (profiles/live.toml)"],
      proposal,
      plane,
      executeRequested,
      approvalProvided,
    );
  }

  if (executeRequested && writes) {
    const accountSnapshot = readAccountSnapshot(plane);
    if (accountSnapshot.source !== "okx-cli") {
      return decision(
        "blocked",
        ["unable to verify account balance/positions from okx CLI; execution is blocked"],
        proposal,
        plane,
        executeRequested,
        approvalProvided,
      );
    }

    const availableUsd = extractAvailableUsd(accountSnapshot.balance);
    const grossExposureUsd = extractGrossExposureUsd(accountSnapshot.positions);
    const positionCount = extractOpenPositionCount(accountSnapshot.positions);
    const projectedExposureUsd = grossExposureUsd + totalOrderNotionalUsd;
    const marginNeededUsd = writeSlices
      .filter((slice) => !slice.reduceOnly)
      .reduce((sum, slice) => sum + slice.notionalUsd * limits.initialMarginRate, 0);

    const accountViolations: string[] = [];
    if (availableUsd === null) {
      accountViolations.push("available USD-equivalent balance could not be parsed from account payload");
    } else if (marginNeededUsd > availableUsd) {
      accountViolations.push(
        `estimated margin ${marginNeededUsd.toFixed(2)} exceeds available balance ${availableUsd.toFixed(2)} USD`,
      );
    }

    if (projectedExposureUsd > limits.maxTotalExposureUsd) {
      accountViolations.push(
        `projected exposure ${projectedExposureUsd.toFixed(2)} exceeds account exposure cap ${limits.maxTotalExposureUsd.toFixed(2)} USD`,
      );
    }

    if (accountViolations.length > 0) {
      return decision("blocked", accountViolations, proposal, plane, executeRequested, approvalProvided);
    }

    if (plane === "live" && writes && !approvalProvided) {
      return decision(
        "require_approval",
        [
          `live write path requires explicit --approve`,
          `account check passed: available=${availableUsd?.toFixed(2) ?? "n/a"} grossExposure=${grossExposureUsd.toFixed(2)} positions=${positionCount}`,
        ],
        proposal,
        plane,
        executeRequested,
        approvalProvided,
      );
    }
  } else if (plane === "live" && writes && !approvalProvided) {
    return decision(
      "require_approval",
      ["live write path requires explicit --approve"],
      proposal,
      plane,
      executeRequested,
      approvalProvided,
    );
  }

  if (record.risk.needsApproval && plane !== "research" && !approvalProvided) {
    return decision(
      "require_approval",
      ["risk gate requires approval for non-research execution"],
      proposal,
      plane,
      executeRequested,
      approvalProvided,
    );
  }

  return decision(
    "approved",
    [
      `policy gate approved this proposal`,
      `order notional=${totalOrderNotionalUsd.toFixed(2)} singleLimit=${limits.maxSingleOrderNotionalUsd.toFixed(2)} totalLimit=${limits.maxTotalOrderNotionalUsd.toFixed(2)}`,
    ],
    proposal,
    plane,
    executeRequested,
    approvalProvided,
  );
}
