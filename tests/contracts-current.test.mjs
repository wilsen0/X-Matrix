import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createArtifactStore, putArtifact } from "../dist/runtime/artifacts.js";
import { applyRun } from "../dist/runtime/executor.js";
import { validateDoctrineCard, validateRuleCard } from "../dist/runtime/contracts.js";
import {
  loadArtifactSnapshot,
  loadExecutionEnvelope,
  loadPolicyEnvelope,
  loadTraceEnvelope,
  saveArtifactSnapshot,
  saveRun,
} from "../dist/runtime/trace.js";

test("artifact store uses sharedState as mirror only and does not seed legacy inputs", () => {
  const sharedState = {
    proposals: [{ name: "protective-put", reason: "legacy proposal" }],
    tradeThesis: {
      directionalRegime: "sideways",
      volState: "normal",
      tailRiskState: "normal",
      hedgeBias: "protective-put",
      conviction: 50,
      riskBudget: {
        maxSingleOrderUsd: 5_000,
        maxPremiumSpendUsd: 500,
        maxMarginUseUsd: 2_000,
        maxCorrelationBucketPct: 40,
      },
      disciplineState: "normal",
      preferredStrategies: ["protective-put"],
      decisionNotes: [],
      ruleRefs: [],
      doctrineRefs: [],
    },
  };

  const artifacts = createArtifactStore(undefined, sharedState);
  assert.equal(artifacts.has("planning.proposals"), false);
  assert.equal(artifacts.has("trade.thesis"), false);

  putArtifact(artifacts, {
    key: "trade.thesis",
    version: 3,
    producer: "test",
    data: {
      directionalRegime: "sideways",
      volState: "normal",
      tailRiskState: "normal",
      hedgeBias: "collar",
      conviction: 45,
      riskBudget: {
        maxSingleOrderUsd: 4_000,
        maxPremiumSpendUsd: 500,
        maxMarginUseUsd: 2_000,
        maxCorrelationBucketPct: 35,
      },
      disciplineState: "normal",
      preferredStrategies: ["collar"],
      decisionNotes: [],
      ruleRefs: [],
      doctrineRefs: [],
    },
  });

  assert.equal(sharedState.tradeThesis.hedgeBias, "collar");
});

test("artifact contracts reject invalid canonical payloads", () => {
  const artifacts = createArtifactStore();

  assert.throws(() => {
    putArtifact(artifacts, {
      key: "trade.thesis",
      version: 3,
      producer: "test",
      data: {
        directionalRegime: "sideways",
        volState: "normal",
        tailRiskState: "normal",
        hedgeBias: "invalid-bias",
        conviction: 50,
        riskBudget: {
          maxSingleOrderUsd: 5_000,
          maxPremiumSpendUsd: 500,
          maxMarginUseUsd: 2_000,
          maxCorrelationBucketPct: 40,
        },
        disciplineState: "normal",
        preferredStrategies: [],
        decisionNotes: [],
        ruleRefs: [],
        doctrineRefs: [],
      },
    });
  }, /hedgeBias/);

  assert.throws(() => {
    validateRuleCard({
      id: "bad",
      doctrineId: "not-real",
      appliesTo: ["policy-gate"],
      inputs: [],
      condition: {},
      action: {},
      priority: 1,
      severity: "low",
      docPath: "docs/rules/test.md",
    });
  }, /doctrineId/);

  assert.throws(() => {
    validateDoctrineCard({
      id: "discipline",
      name: "",
      principles: [],
      defaultWeights: {},
      riskBias: "strict",
      linkedRuleIds: [],
      docPath: "docs/books/discipline.md",
    });
  }, /name/);
});

test("applyRun rejects runs without artifacts.json in current development mode", async () => {
  const runId = `run_legacy_apply_${Date.now()}`;
  const runsDir = join(process.cwd(), "runs");
  const runFile = join(runsDir, `${runId}.json`);

  const legacyProposal = {
    name: "protective-put",
    reason: "legacy hedge proposal",
    estimatedCost: "250 USD premium budget",
    estimatedProtection: "downside convexity on BTC",
    requiredModules: ["account", "market", "option"],
    orderPlan: [
      {
        kind: "option-place-order",
        purpose: "Buy downside protection put leg.",
        symbol: "BTC",
        targetPremiumUsd: 250,
        referencePx: 70_000,
        params: {
          instId: "BTC-USD-260327-65000-P",
          side: "buy",
          sz: "1",
          px: "0.05",
        },
        strategy: "protective-put",
        leg: "protective-put",
      },
    ],
  };

  await mkdir(runsDir, { recursive: true });
  await writeFile(
    runFile,
    JSON.stringify(
        {
          kind: "trademesh-run",
          version: 3,
          id: runId,
          goal: "legacy run hedge",
          plane: "demo",
          status: "ready",
          routeKind: "workflow",
          route: ["portfolio-xray", "market-scan", "hedge-planner", "policy-gate", "official-executor"],
        trace: [
          {
            skill: "portfolio-xray",
            stage: "sensor",
            goal: "legacy run hedge",
            summary: "portfolio snapshot",
            facts: [],
            constraints: {},
            proposal: [],
            risk: { score: 0.1, maxLoss: "n/a", needsApproval: false, reasons: [] },
            permissions: { plane: "demo", officialWriteOnly: true, allowedModules: ["account"] },
            handoff: "market-scan",
            metadata: {
              portfolioSnapshot: {
                source: "okx-cli",
                symbols: ["BTC"],
                drawdownTarget: "4%",
                balance: { code: "0", data: [{ details: [{ ccy: "USDT", availBal: "25000", usdEq: "25000" }] }] },
                positions: { code: "0", data: [] },
                commands: [],
                errors: [],
                accountEquity: 100_000,
                availableUsd: 25_000,
              },
              riskProfile: {
                directionalExposure: { longUsd: 18_000, shortUsd: 0, netUsd: 18_000, dominantSide: "long" },
                concentration: {
                  grossUsd: 20_000,
                  topSymbol: "BTC",
                  topSharePct: 45,
                  top3: [{ symbol: "BTC", usd: 9_000, sharePct: 45 }],
                },
                leverageHotspots: [],
                feeDrag: { recentFeePaidUsd: 0, recentFeeRows: 0 },
                correlationBuckets: [{ bucketId: "crypto-beta", symbols: ["BTC"], grossUsd: 9_000, sharePct: 45 }],
              },
            },
            timestamp: "2026-03-20T10:00:00.000Z",
          },
        ],
        facts: [],
        constraints: {
          selectedSymbols: ["BTC"],
          drawdownTarget: "4%",
        },
        proposals: [legacyProposal],
        risk: { score: 0.3, maxLoss: "n/a", needsApproval: true, reasons: [] },
        permissions: { plane: "demo", officialWriteOnly: true, allowedModules: ["account", "market", "option"] },
        capabilitySnapshot: {
          okxCliAvailable: true,
          configPath: "profiles",
          configExists: true,
          demoProfileLikelyConfigured: true,
          liveProfileLikelyConfigured: false,
          readinessGrade: "A",
          blockers: [],
          recommendedPlane: "demo",
          warnings: [],
        },
        approved: false,
        executions: [],
        errors: [],
        selectedProposal: "protective-put",
        notes: [],
        createdAt: "2026-03-20T10:00:00.000Z",
        updatedAt: "2026-03-20T10:00:00.000Z",
      },
      null,
      2,
    ),
  );

  try {
    await assert.rejects(
      () =>
        applyRun(runId, {
          plane: "demo",
          proposalName: "protective-put",
          approve: true,
          execute: false,
        }),
      /only supports current runs|archive old run state/i,
    );
  } finally {
    await rm(runFile, { force: true });
    await rm(join(process.cwd(), ".trademesh", "runs", runId), { recursive: true, force: true });
  }
});

test("artifact store rejects outdated artifact payload versions", () => {
  assert.throws(() => {
    createArtifactStore({
      "trade.thesis": {
        key: "trade.thesis",
        version: 1,
        producer: "legacy-test",
        createdAt: "2026-03-21T10:00:00.000Z",
        data: {
          directionalRegime: "sideways",
          volState: "normal",
          tailRiskState: "normal",
          hedgeBias: "protective-put",
          conviction: 55,
          riskBudget: {
            maxSingleOrderUsd: 4_000,
            maxPremiumSpendUsd: 600,
            maxMarginUseUsd: 3_000,
            maxCorrelationBucketPct: 45,
          },
          disciplineState: "normal",
          preferredStrategies: ["protective-put"],
          decisionNotes: [],
          ruleRefs: [],
          doctrineRefs: [],
        },
        ruleRefs: [],
        doctrineRefs: [],
      },
    });
  }, /must use current version 3/i);
});

test("saveArtifactSnapshot writes the current envelope format", async () => {
  const runId = `run_artifact_envelope_${Date.now()}`;
  const runDir = join(process.cwd(), ".trademesh", "runs", runId);
  await mkdir(runDir, { recursive: true });

  try {
    await saveArtifactSnapshot(runId, {
      "policy.plan-decision": {
        key: "policy.plan-decision",
        version: 3,
        producer: "policy-gate",
        createdAt: "2026-03-21T10:00:00.000Z",
        data: {
          outcome: "approved",
          reasons: [],
          proposal: "protective-put",
          plane: "demo",
          executeRequested: false,
          approvalProvided: true,
          evaluatedAt: "2026-03-21T10:00:00.000Z",
          phase: "plan",
          ruleRefs: [],
          doctrineRefs: [],
          breachFlags: [],
        },
        ruleRefs: [],
        doctrineRefs: [],
      },
    });

    const raw = JSON.parse(await readFile(join(runDir, "artifacts.json"), "utf8"));
    assert.equal(raw.kind, "trademesh-artifacts");
    assert.equal(raw.version, 3);

    const loaded = await loadArtifactSnapshot(runId);
    assert.ok(loaded["policy.plan-decision"]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("loadArtifactSnapshot rejects legacy raw artifact snapshots", async () => {
  const runId = `run_artifact_legacy_${Date.now()}`;
  const runDir = join(process.cwd(), ".trademesh", "runs", runId);
  await mkdir(runDir, { recursive: true });

  try {
    await writeFile(
      join(runDir, "artifacts.json"),
      JSON.stringify(
        {
          "policy.plan-decision": {
            key: "policy.plan-decision",
            version: 3,
            producer: "legacy-policy",
            createdAt: "2026-03-21T10:00:00.000Z",
            data: {
              outcome: "approved",
              reasons: [],
              proposal: "protective-put",
              plane: "demo",
              executeRequested: false,
              approvalProvided: true,
              evaluatedAt: "2026-03-21T10:00:00.000Z",
              phase: "plan",
              ruleRefs: [],
              doctrineRefs: [],
              breachFlags: [],
            },
            ruleRefs: [],
            doctrineRefs: [],
          },
        },
        null,
        2,
      ),
    );

    await assert.rejects(() => loadArtifactSnapshot(runId), /unsupported legacy format|archive dev state/i);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("saveRun writes current trace/policy/execution envelopes", async () => {
  const runId = `run_persistence_envelopes_${Date.now()}`;

  const record = {
    kind: "trademesh-run",
    version: 3,
    id: runId,
    goal: "validate persistence envelopes",
    plane: "demo",
    status: "ready",
    routeKind: "workflow",
    route: ["portfolio-xray", "replay"],
    trace: [
      {
        skill: "portfolio-xray",
        stage: "sensor",
        goal: "validate persistence envelopes",
        summary: "snapshot",
        facts: [],
        constraints: {},
        proposal: [],
        risk: { score: 0, maxLoss: "n/a", needsApproval: false, reasons: [] },
        permissions: { plane: "demo", officialWriteOnly: true, allowedModules: [] },
        handoff: "replay",
        timestamp: "2026-03-21T10:00:00.000Z",
      },
    ],
    facts: [],
    constraints: {},
    proposals: [],
    risk: { score: 0, maxLoss: "n/a", needsApproval: false, reasons: [] },
    permissions: { plane: "demo", officialWriteOnly: true, allowedModules: [] },
    capabilitySnapshot: {
      okxCliAvailable: true,
      configPath: "profiles",
      configExists: true,
      demoProfileLikelyConfigured: true,
      liveProfileLikelyConfigured: false,
      readinessGrade: "A",
      blockers: [],
      recommendedPlane: "demo",
      warnings: [],
    },
    policyDecision: {
      outcome: "approved",
      reasons: [],
      proposal: "protective-put",
      plane: "demo",
      executeRequested: false,
      approvalProvided: true,
      evaluatedAt: "2026-03-21T10:00:00.000Z",
      phase: "plan",
      ruleRefs: [],
      doctrineRefs: [],
      breachFlags: [],
    },
    approved: true,
    executions: [],
    errors: [],
    notes: [],
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
  };

  try {
    await saveRun(record);

    const trace = await loadTraceEnvelope(runId);
    const policy = await loadPolicyEnvelope(runId);
    const execution = await loadExecutionEnvelope(runId);

    assert.equal(trace?.kind, "trademesh-trace");
    assert.equal(trace?.version, 3);
    assert.equal(policy?.kind, "trademesh-policy");
    assert.equal(policy?.version, 3);
    assert.equal(execution?.kind, "trademesh-executions");
    assert.equal(execution?.version, 3);
  } finally {
    await rm(join(process.cwd(), "runs", `${runId}.json`), { force: true });
    await rm(join(process.cwd(), ".trademesh", "runs", runId), { recursive: true, force: true });
  }
});

test("loadTraceEnvelope rejects legacy trace snapshots", async () => {
  const runId = `run_trace_legacy_${Date.now()}`;
  const runDir = join(process.cwd(), ".trademesh", "runs", runId);
  await mkdir(runDir, { recursive: true });

  try {
    await writeFile(
      join(runDir, "trace.json"),
      JSON.stringify(
        {
          runId,
          goal: "legacy trace",
          plane: "demo",
          status: "ready",
          createdAt: "2026-03-21T10:00:00.000Z",
          updatedAt: "2026-03-21T10:00:00.000Z",
          trace: [],
          executions: [],
          errors: [],
        },
        null,
        2,
      ),
    );

    await assert.rejects(() => loadTraceEnvelope(runId), /unsupported legacy format|version 2/i);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("loadPolicyEnvelope rejects legacy policy snapshots", async () => {
  const runId = `run_policy_legacy_${Date.now()}`;
  const runDir = join(process.cwd(), ".trademesh", "runs", runId);
  await mkdir(runDir, { recursive: true });

  try {
    await writeFile(
      join(runDir, "policy.json"),
      JSON.stringify(
        {
          outcome: "approved",
          reasons: [],
          proposal: "protective-put",
          plane: "demo",
          executeRequested: false,
          approvalProvided: true,
          evaluatedAt: "2026-03-21T10:00:00.000Z",
        },
        null,
        2,
      ),
    );

    await assert.rejects(() => loadPolicyEnvelope(runId), /unsupported legacy format|version 2/i);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("loadExecutionEnvelope rejects legacy execution snapshots", async () => {
  const runId = `run_execution_legacy_${Date.now()}`;
  const runDir = join(process.cwd(), ".trademesh", "runs", runId);
  await mkdir(runDir, { recursive: true });

  try {
    await writeFile(
      join(runDir, "executions.json"),
      JSON.stringify(
        {
          executions: [],
          errors: [],
        },
        null,
        2,
      ),
    );

    await assert.rejects(() => loadExecutionEnvelope(runId), /unsupported legacy format|version 2/i);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
