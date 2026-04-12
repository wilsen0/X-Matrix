import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActionsFromIntents,
  buildOptionPlaceOrderCommand,
  buildPlaneFlagArgs,
  buildReadIntents,
  buildSwapPlaceOrderCommand,
  createClientOrderRef,
  formatPrice,
  previewEntry,
  resolveWalletFromArtifacts,
  toNumber,
  writeIntentForStep,
} from "../dist/runtime/official-skill-adapter.js";

// ── formatPrice ──────────────────────────────────────────────────────────────

test("formatPrice formats large prices to 1 decimal", () => {
  assert.equal(formatPrice(70_000), "70000.0");
  assert.equal(formatPrice(10_500), "10500.0");
});

test("formatPrice formats mid-range prices to 2 decimals", () => {
  assert.equal(formatPrice(1_500), "1500.00");
});

test("formatPrice formats small prices to 3 or 4 decimals", () => {
  assert.equal(formatPrice(50), "50.000");
  assert.equal(formatPrice(0.5), "0.5000");
});

// ── toNumber ─────────────────────────────────────────────────────────────────

test("toNumber returns number for finite input", () => {
  assert.equal(toNumber(42), 42);
  assert.equal(toNumber("1,200.5"), 1200.5);
});

test("toNumber returns undefined for non-finite input", () => {
  assert.equal(toNumber("abc"), undefined);
  assert.equal(toNumber(NaN), undefined);
  assert.equal(toNumber(null), undefined);
});

// ── buildPlaneFlagArgs ───────────────────────────────────────────────────────

test("buildPlaneFlagArgs returns demo flags", () => {
  const args = buildPlaneFlagArgs("demo");
  assert.deepStrictEqual(args, ["--profile", "demo", "--json"]);
});

test("buildPlaneFlagArgs returns live flags", () => {
  const args = buildPlaneFlagArgs("live");
  assert.deepStrictEqual(args, ["--profile", "live", "--json"]);
});

test("buildPlaneFlagArgs returns json-only for research", () => {
  const args = buildPlaneFlagArgs("research");
  assert.deepStrictEqual(args, ["--json"]);
});

// ── buildSwapPlaceOrderCommand ───────────────────────────────────────────────

test("buildSwapPlaceOrderCommand produces a swap order command", () => {
  const cmd = buildSwapPlaceOrderCommand({
    instId: "BTC-USDT-SWAP",
    tdMode: "cross",
    side: "sell",
    ordType: "limit",
    sz: "0.03",
    px: "69950",
    reduceOnly: false,
  }, "demo");

  assert.ok(cmd.startsWith("okx swap place-order"));
  assert.ok(cmd.includes("--instId BTC-USDT-SWAP"));
  assert.ok(cmd.includes("--side sell"));
  assert.ok(cmd.includes("--sz 0.03"));
  assert.ok(cmd.includes("--profile demo"));
  assert.ok(cmd.includes("--clOrdId") === false);
});

test("buildSwapPlaceOrderCommand includes clOrdId when provided", () => {
  const cmd = buildSwapPlaceOrderCommand({
    instId: "BTC-USDT-SWAP",
    tdMode: "cross",
    side: "sell",
    ordType: "limit",
    sz: "0.03",
    px: "69950",
    clOrdId: "tm_abc123",
  }, "demo");

  assert.ok(cmd.includes("--clOrdId tm_abc123"));
});

// ── buildOptionPlaceOrderCommand ─────────────────────────────────────────────

test("buildOptionPlaceOrderCommand produces an option order command", () => {
  const cmd = buildOptionPlaceOrderCommand({
    instId: "BTC-USD-260327-90000-P",
    side: "buy",
    sz: "1",
    px: "0.05",
  }, "demo");

  assert.ok(cmd.startsWith("okx option place-order"));
  assert.ok(cmd.includes("--side buy"));
  assert.ok(cmd.includes("--sz 1"));
  assert.ok(cmd.includes("--profile demo"));
});

// ── buildReadIntents ─────────────────────────────────────────────────────────

test("buildReadIntents produces balance + positions + ticker intents", () => {
  const intents = buildReadIntents(["BTC", "ETH"], "demo", "run_1", "test-proposal");

  assert.equal(intents.length, 4); // balance + positions + BTC ticker + ETH ticker
  assert.ok(intents[0].command.includes("account balance"));
  assert.ok(intents[1].command.includes("account positions"));
  assert.ok(intents[2].command.includes("market ticker BTC-USDT"));
  assert.ok(intents[3].command.includes("market ticker ETH-USDT"));
  assert.equal(intents[0].module, "account");
  assert.equal(intents[2].module, "market");
});

// ── createClientOrderRef ─────────────────────────────────────────────────────

test("createClientOrderRef produces deterministic refs", () => {
  const ref1 = createClientOrderRef("run_1", "proposal", 0);
  const ref2 = createClientOrderRef("run_1", "proposal", 0);
  const ref3 = createClientOrderRef("run_1", "proposal", 1);

  assert.ok(ref1.startsWith("tm"));
  assert.equal(ref1, ref2);
  assert.notEqual(ref1, ref3);
});

// ── resolveWalletFromArtifacts ───────────────────────────────────────────────

test("resolveWalletFromArtifacts returns wallet when present", () => {
  const result = resolveWalletFromArtifacts({
    walletAddress: "0xabc",
    chain: "xlayer",
    source: "env",
    resolvedAt: "2026-04-12T00:00:00.000Z",
  });
  assert.equal(result.walletAddress, "0xabc");
  assert.equal(result.chain, "xlayer");
});

test("resolveWalletFromArtifacts defaults chain to xlayer when absent", () => {
  const result = resolveWalletFromArtifacts(undefined);
  assert.equal(result.walletAddress, undefined);
  assert.equal(result.chain, "xlayer");
});

// ── buildActionsFromIntents ──────────────────────────────────────────────────

test("buildActionsFromIntents maps intents to actions with wallet metadata", () => {
  const intents = buildReadIntents(["BTC"], "demo", "run_1", "test");
  const actions = buildActionsFromIntents(intents, "0xdead", "xlayer");

  assert.equal(actions.length, intents.length);
  assert.equal(actions[0].wallet, "0xdead");
  assert.equal(actions[0].chain, "xlayer");
  assert.equal(actions[0].integration, "official-skill");
});

// ── previewEntry ─────────────────────────────────────────────────────────────

test("previewEntry maps intent to preview entry", () => {
  const intents = buildReadIntents(["BTC"], "demo", "run_1", "test");
  const entry = previewEntry(intents[0]);

  assert.equal(entry.intentId, intents[0].intentId);
  assert.equal(entry.command, intents[0].command);
  assert.equal(entry.safeToRetry, true);
});

// ── writeIntentForStep ───────────────────────────────────────────────────────

test("writeIntentForStep creates swap write intent with clOrdId", () => {
  const intent = writeIntentForStep({
    kind: "swap-place-order",
    purpose: "Open short.",
    symbol: "BTC",
    targetNotionalUsd: 2000,
    referencePx: 70_000,
    params: {
      instId: "BTC-USDT-SWAP",
      tdMode: "cross",
      side: "sell",
      ordType: "limit",
      sz: "0.03",
      px: "69950",
    },
  }, "demo", "run_1", "test", 0);

  assert.ok(intent.command.startsWith("okx swap place-order"));
  assert.ok(intent.command.includes("--clOrdId"));
  assert.equal(intent.requiresWrite, true);
  assert.equal(intent.safeToRetry, false);
  assert.ok(typeof intent.clientOrderRef === "string");
});

test("writeIntentForStep creates option write intent", () => {
  const intent = writeIntentForStep({
    kind: "option-place-order",
    purpose: "Buy put.",
    symbol: "BTC",
    targetPremiumUsd: 220,
    referencePx: 70_000,
    params: {
      instId: "BTC-USD-260327-90000-P",
      side: "buy",
      sz: "1",
      px: "0.05",
    },
  }, "demo", "run_1", "test", 1);

  assert.ok(intent.command.startsWith("okx option place-order"));
  assert.equal(intent.module, "option");
  assert.equal(intent.requiresWrite, true);
});
