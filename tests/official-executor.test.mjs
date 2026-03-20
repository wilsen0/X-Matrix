import assert from "node:assert/strict";
import test from "node:test";
import run from "../dist/skills/official-executor/run.js";
import { buildReferencePayloads, createContext, withMockOkx } from "./test-helpers.mjs";

test("official-executor materializes protective-put option place-order command", async () => {
  const payloads = await buildReferencePayloads();
  await withMockOkx(payloads, async () => {
    const output = await run(
      createContext({
        skill: "official-executor",
        stage: "executor",
        sharedState: {
          selectedProposal: "protective-put",
          selectedProposalOrderPlan: [],
          selectedProposalIntents: [],
          symbols: ["BTC"],
          drawdownTarget: "4%",
        },
      }),
    );

    const preview = Array.isArray(output.metadata?.commandPreview) ? output.metadata.commandPreview : [];
    const optionCommands = preview.filter(
      (command) => typeof command === "string" && command.startsWith("okx option place-order"),
    );

    assert.equal(output.skill, "official-executor");
    assert.equal(output.stage, "executor");
    assert.ok(optionCommands.length >= 1);
    assert.ok(optionCommands[0].includes("--side buy"));
    assert.ok(optionCommands[0].includes("--sz 1"));
    assert.ok(optionCommands[0].includes("--px"));
    assert.equal(output.constraints.optionWriteIntentCount, 1);
  });
});
