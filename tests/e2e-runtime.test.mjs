import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyRun, createPlan, exportRun, listRuns, replayRun } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("runtime supports plan -> apply --approve -> replay through mocked OKX CLI", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = { code: "0", data: [] };
  payloads.accountBalance = {
    code: "0",
    data: [{ details: [{ ccy: "USDT", availBal: "50000", usdEq: "50000" }] }],
  };

  let runId = null;
  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my btc drawdown with demo first", { plane: "demo" });
    runId = planned.id;

    assert.ok(planned.route.includes("trade-thesis"));
    assert.ok(planned.route.includes("scenario-sim"));
    assert.ok(planned.proposals.length > 0);

    const applied = await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      execute: false,
    });

    assert.ok(["dry_run", "approval_required", "blocked"].includes(applied.status));
    assert.ok(applied.executions.length >= 1);

    const replayed = await replayRun(planned.id);
    assert.equal(replayed.trace.at(-1)?.skill, "replay");
  });

  if (runId) {
    await cleanupRunArtifacts(runId);
  }
});

test("apply execute with approved-by produces ticket and idempotent skip on repeated run", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";

  try {
    await withMockOkx(payloads, async () => {
      const planned = await createPlan("hedge my btc drawdown with demo execute", { plane: "demo" });
      runId = planned.id;

      const executed = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });
      assert.equal(executed.status, "executed");
      assert.equal(typeof executed.executions.at(-1)?.approvalTicketId, "string");

      const repeated = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });
      const idempotentHits = repeated.executions.at(-1)?.results.filter((result) =>
        result.stderr.includes("skipped(idempotent-hit)")
      ) ?? [];
      assert.ok(idempotentHits.length >= 1);
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
  }

  await cleanupRunArtifacts(runId);
});

test("apply enforces research, demo, and live plane gates through the runtime", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = { code: "0", data: [] };
  payloads.accountBalance = {
    code: "0",
    data: [{ details: [{ ccy: "USDT", availBal: "50000", usdEq: "50000" }] }],
  };

  let runId = null;
  const previousHome = process.env.HOME;

  try {
    await withMockOkx(payloads, async () => {
      const planned = await createPlan("hedge my btc drawdown with demo first", { plane: "demo" });
      runId = planned.id;
      const recommended = planned.proposals.find((proposal) => proposal.recommended);

      assert.equal(planned.selectedProposal, recommended?.name ?? planned.proposals[0]?.name);

      const researchApplied = await applyRun(planned.id, {
        plane: "research",
        approve: true,
        execute: false,
      });
      assert.equal(researchApplied.status, "blocked");
      assert.ok(researchApplied.policyDecision?.reasons.includes("research plane blocks all write intents"));

      const demoApplied = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        execute: false,
      });
      assert.equal(demoApplied.status, "dry_run");

      const liveApplied = await applyRun(planned.id, {
        plane: "live",
        approve: false,
        execute: false,
      });
      assert.equal(liveApplied.status, "approval_required");
      assert.ok(
        liveApplied.policyDecision?.reasons.includes("live write path requires explicit --approve"),
      );
    });
  } finally {
    process.env.HOME = previousHome;
    await cleanupRunArtifacts(runId);
  }
});

test("runs list shows runtime summary columns for recent runs", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = { code: "0", data: [] };
  payloads.accountBalance = {
    code: "0",
    data: [{ details: [{ ccy: "USDT", availBal: "50000", usdEq: "50000" }] }],
  };

  let runId = null;
  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my btc drawdown with demo first", { plane: "demo" });
    runId = planned.id;
    await exportRun(planned.id);

    const runs = await listRuns();
    const row = runs.runs.find((entry) => entry.goal === planned.goal && entry.createdAt === planned.createdAt);

    assert.ok(runs.summary.includes("Updated"));
    assert.ok(runs.summary.includes("Exported"));
    assert.ok(runs.summary.includes("Route"));
    assert.ok(runs.summary.includes("Proposal"));
    assert.ok(row);
    assert.equal(row.selectedProposal, planned.selectedProposal);
    assert.ok(row.route.includes("official-executor"));
    assert.equal(row.exported, true);
  });

  await cleanupRunArtifacts(runId);
});

test("goal intake overrides remain consistent across plan, apply, replay, and export", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my drawdown with demo first", {
      plane: "demo",
      goalOverrides: {
        symbols: ["ETH"],
        targetDrawdownPct: 3.5,
        hedgeIntent: "protect_downside",
        timeHorizon: "swing",
      },
    });
    runId = planned.id;

    const artifactSnapshot = await loadArtifactSnapshot(planned.id);
    const goalIntake = artifactSnapshot["goal.intake"]?.data;
    assert.deepEqual(goalIntake?.symbols, ["ETH"]);
    assert.equal(goalIntake?.targetDrawdownPct, 3.5);
    assert.equal(goalIntake?.hedgeIntent, "protect_downside");
    assert.equal(goalIntake?.timeHorizon, "swing");

    const applied = await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      execute: false,
    });
    const replayed = await replayRun(planned.id);
    const exported = await exportRun(planned.id);
    const bundle = JSON.parse(await readFile(exported.bundlePath, "utf8"));

    assert.ok(applied.executions.length > 0);
    assert.equal(replayed.trace.at(-1)?.skill, "replay");
    assert.deepEqual(bundle.goalIntake.symbols, ["ETH"]);
    assert.equal(bundle.goalIntake.targetDrawdownPct, 3.5);
    assert.equal(bundle.goalIntake.hedgeIntent, "protect_downside");
    assert.equal(bundle.goalIntake.timeHorizon, "swing");
  });

  await cleanupRunArtifacts(runId);
});
