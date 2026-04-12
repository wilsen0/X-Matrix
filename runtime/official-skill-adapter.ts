import { createCommandIntent } from "./okx.js";
import { createHash } from "node:crypto";
import type {
  AgentWalletIdentity,
  CommandPreviewEntry,
  ExecutionAction,
  OkxCommandIntent,
  OptionPlaceOrderParams,
  OrderPlanStep,
  SwapPlaceOrderParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Official Skill Adapter
//
// This module contains the OKX CLI command-building concern that was
// previously embedded inside the official-executor skill.  Extracting it
// here achieves two things:
//
//   1. The executor skill stays focused on proposal selection, risk-budget
//      materialization, and orchestration — not on command syntax.
//   2. Future skill packs (e.g. a "rebalance" pack) can reuse the same
//      command-building helpers without duplicating code or importing from
//      a skill directory.
//
// Backward compatibility: the executor still produces identical output.
// OkxCommandIntent is not modified.
// ---------------------------------------------------------------------------

// ── Utilities ────────────────────────────────────────────────────────────────

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function formatPrice(px: number): string {
  if (px >= 10_000) {
    return px.toFixed(1);
  }
  if (px >= 1_000) {
    return px.toFixed(2);
  }
  if (px >= 10) {
    return px.toFixed(3);
  }
  return px.toFixed(4);
}

// ── Plane flags ──────────────────────────────────────────────────────────────

export type PlaneLike = "research" | "demo" | "live";

export function buildPlaneFlagArgs(plane: PlaneLike): string[] {
  if (plane === "demo") {
    return ["--profile", "demo", "--json"];
  }
  if (plane === "live") {
    return ["--profile", "live", "--json"];
  }
  return ["--json"];
}

// ── Swap / Option command construction ───────────────────────────────────────

export function buildSwapPlaceOrderCommand(params: SwapPlaceOrderParams, plane: PlaneLike): string {
  const args = [
    "okx",
    "swap",
    "place-order",
    "--instId",
    params.instId,
    "--tdMode",
    params.tdMode,
    "--side",
    params.side,
    "--ordType",
    params.ordType,
    "--sz",
    params.sz,
  ];

  if (params.px && params.ordType !== "market") {
    args.push("--px", params.px);
  }
  if (params.reduceOnly !== undefined) {
    args.push("--reduceOnly", String(params.reduceOnly));
  }
  if (params.posSide) {
    args.push("--posSide", params.posSide);
  }
  if (params.tpTriggerPx) {
    args.push("--tpTriggerPx", params.tpTriggerPx, "--tpOrdPx", params.tpOrdPx ?? "-1");
  }
  if (params.slTriggerPx) {
    args.push("--slTriggerPx", params.slTriggerPx, "--slOrdPx", params.slOrdPx ?? "-1");
  }
  if (params.tag) {
    args.push("--tag", params.tag);
  }
  if (params.clOrdId) {
    args.push("--clOrdId", params.clOrdId);
  }
  args.push(...buildPlaneFlagArgs(plane));
  return args.join(" ");
}

export function buildOptionPlaceOrderCommand(params: OptionPlaceOrderParams, plane: PlaneLike): string {
  return [
    "okx",
    "option",
    "place-order",
    "--instId",
    params.instId,
    "--side",
    params.side,
    "--sz",
    params.sz,
    "--px",
    params.px,
    ...buildPlaneFlagArgs(plane),
  ].join(" ");
}

// ── Read intents ─────────────────────────────────────────────────────────────

export function buildReadIntents(
  symbols: string[],
  plane: PlaneLike,
  runId: string,
  proposalName: string,
): OkxCommandIntent[] {
  const flags = buildPlaneFlagArgs(plane).join(" ");
  return [
    createCommandIntent(`okx account balance ${flags}`, {
      intentId: `${runId}:${proposalName}:read-balance`,
      stepIndex: 0,
      safeToRetry: true,
      module: "account",
      requiresWrite: false,
      reason: "Refresh account balance before materializing execution.",
    }),
    createCommandIntent(`okx account positions ${flags}`, {
      intentId: `${runId}:${proposalName}:read-positions`,
      stepIndex: 1,
      safeToRetry: true,
      module: "account",
      requiresWrite: false,
      reason: "Refresh account positions before materializing execution.",
    }),
    ...symbols.map((symbol, index) =>
      createCommandIntent(`okx market ticker ${symbol}-USDT ${flags}`, {
        intentId: `${runId}:${proposalName}:read-ticker:${symbol.toLowerCase()}`,
        stepIndex: index + 2,
        safeToRetry: true,
        module: "market",
        requiresWrite: false,
        reason: `Refresh ${symbol} price before materializing execution.`,
      })),
  ];
}

// ── Client order ref ─────────────────────────────────────────────────────────

export function createClientOrderRef(runId: string, proposalName: string, stepIndex: number): string {
  const fingerprint = createHash("sha256")
    .update(`${runId}|${proposalName}|${stepIndex}`)
    .digest("hex")
    .slice(0, 22);
  return `tm${fingerprint}`;
}

// ── Write intent for a single step ──────────────────────────────────────────

export function writeIntentForStep(
  step: OrderPlanStep,
  plane: PlaneLike,
  runId: string,
  proposalName: string,
  stepIndex: number,
): OkxCommandIntent {
  const clientOrderRef = createClientOrderRef(runId, proposalName, stepIndex);
  if (step.kind === "swap-place-order") {
    const params: SwapPlaceOrderParams = {
      ...step.params,
      clOrdId: clientOrderRef,
    };
    return createCommandIntent(buildSwapPlaceOrderCommand(params, plane), {
      intentId: `${runId}:${proposalName}:write:${stepIndex}`,
      stepIndex,
      safeToRetry: false,
      module: "swap",
      requiresWrite: true,
      clientOrderRef,
      reason: step.purpose,
    });
  }

  return createCommandIntent(buildOptionPlaceOrderCommand(step.params, plane), {
    intentId: `${runId}:${proposalName}:write:${stepIndex}`,
    stepIndex,
    safeToRetry: false,
    module: "option",
    requiresWrite: true,
    clientOrderRef,
    reason: step.purpose,
  });
}

// ── Actions from intents ─────────────────────────────────────────────────────

export function buildActionsFromIntents(
  intents: OkxCommandIntent[],
  walletAddress: string | undefined,
  chain: string | undefined,
): ExecutionAction[] {
  return intents.map((intent) => ({
    actionId: intent.intentId,
    stepIndex: intent.stepIndex,
    kind: intent.module === "swap"
      ? "swap-place-order" as const
      : intent.module === "option"
        ? "option-place-order" as const
        : "cross-chain-transfer" as const,
    module: intent.module,
    requiresWrite: intent.requiresWrite,
    safeToRetry: intent.safeToRetry,
    command: intent.command,
    reason: intent.reason,
    wallet: walletAddress,
    chain: chain,
    clientOrderRef: intent.clientOrderRef,
    integration: "official-skill",
  }));
}

// ── Wallet / chain adapter helpers ──────────────────────────────────────────

export function resolveWalletFromArtifacts(
  walletArtifact: AgentWalletIdentity | undefined,
): { walletAddress: string | undefined; chain: string } {
  return {
    walletAddress: walletArtifact?.walletAddress,
    chain: walletArtifact?.chain ?? "xlayer",
  };
}

export function previewEntry(intent: OkxCommandIntent): CommandPreviewEntry {
  return {
    intentId: intent.intentId,
    stepIndex: intent.stepIndex,
    module: intent.module,
    requiresWrite: intent.requiresWrite,
    safeToRetry: intent.safeToRetry,
    clientOrderRef: intent.clientOrderRef,
    reason: intent.reason,
    command: intent.command,
  };
}
