import assert from "node:assert/strict";
import test from "node:test";
import run from "../dist/skills/portfolio-xray/run.js";
import { buildReferencePayloads, createContext, withMockOkx } from "./test-helpers.mjs";

test("portfolio-xray outputs structured sensor snapshot with mocked OKX data", async () => {
  const payloads = await buildReferencePayloads();
  await withMockOkx(payloads, async () => {
    const sharedState = {};
    const output = await run(
      createContext({
        skill: "portfolio-xray",
        stage: "sensor",
        sharedState,
      }),
    );

    assert.equal(output.skill, "portfolio-xray");
    assert.equal(output.stage, "sensor");
    assert.ok(output.facts.length > 0);
    assert.ok(Array.isArray(output.constraints.selectedSymbols));
    assert.equal(output.metadata?.accountSource, "okx-cli");
    assert.ok(sharedState.accountSnapshot);
    assert.ok(sharedState.portfolioRiskProfile);
  });
});
