import assert from "node:assert/strict";
import test from "node:test";
import run from "../dist/skills/market-scan/run.js";
import { buildReferencePayloads, createContext, withMockOkx } from "./test-helpers.mjs";

test("market-scan reads mocked ticker/candle/funding/orderbook snapshots", async () => {
  const payloads = await buildReferencePayloads();
  await withMockOkx(payloads, async () => {
    const sharedState = {
      symbols: ["BTC"],
    };
    const output = await run(
      createContext({
        skill: "market-scan",
        stage: "sensor",
        sharedState,
      }),
    );

    assert.equal(output.skill, "market-scan");
    assert.equal(output.stage, "sensor");
    assert.equal(output.constraints.marketSnapshotMode, "okx-cli");
    assert.ok(output.facts.some((fact) => fact.includes("Snapshot coverage")));
    assert.ok(sharedState.marketSnapshot);
  });
});
