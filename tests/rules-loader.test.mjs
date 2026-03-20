import assert from "node:assert/strict";
import test from "node:test";
import { findRule, loadRules } from "../dist/runtime/rules-loader.js";

test("rules-loader parses @rule markers from markdown code blocks", async () => {
  const doc = await loadRules("risk-limits.md");

  assert.equal(doc.file, "risk-limits.md");
  assert.ok(doc.rules.length > 0);
  assert.ok(doc.rules.some((rule) => rule.id === "max-single-order"));
  assert.ok(doc.rules.some((rule) => rule.id === "volatility-adjustment"));
});

test("rules-loader findRule locates a rule by id", async () => {
  const doc = await loadRules("hedging-strats.md");
  const fundingRule = findRule(doc, "funding-rate-priority");

  assert.ok(fundingRule);
  assert.equal(fundingRule?.id, "funding-rate-priority");
  assert.ok(fundingRule?.code.includes("@rule funding-rate-priority"));
});

test("rules-loader extracts rule parameters correctly", async () => {
  const riskDoc = await loadRules("risk-limits.md");
  const singleOrderRule = findRule(riskDoc, "max-single-order");
  const volatilityRule = findRule(riskDoc, "volatility-adjustment");

  assert.equal(singleOrderRule?.params.multiplier, "0.02");
  assert.equal(volatilityRule?.params.threshold, "0.05");
  assert.equal(volatilityRule?.params.factor, "0.5");
});
