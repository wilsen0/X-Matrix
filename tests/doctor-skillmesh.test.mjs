import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDoctor } from "../dist/runtime/doctor.js";
import { describeSkillGraph, inspectSkill, runDemo } from "../dist/runtime/executor.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

async function withTempHome(configToml, fn) {
  const dir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-home-"));
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = dir;
    if (configToml) {
      const okxDir = join(dir, ".okx");
      await mkdir(okxDir, { recursive: true });
      await writeFile(join(okxDir, "config.toml"), configToml, "utf8");
    }
    return await fn(dir);
  } finally {
    process.env.HOME = previousHome;
    await rm(dir, { recursive: true, force: true });
  }
}

async function withProfilesRoot(pathValue, fn) {
  const previousProfilesRoot = process.env.TRADEMESH_PROFILES_ROOT;

  try {
    if (pathValue) {
      process.env.TRADEMESH_PROFILES_ROOT = pathValue;
    } else {
      delete process.env.TRADEMESH_PROFILES_ROOT;
    }

    return await fn();
  } finally {
    if (previousProfilesRoot === undefined) {
      delete process.env.TRADEMESH_PROFILES_ROOT;
    } else {
      process.env.TRADEMESH_PROFILES_ROOT = previousProfilesRoot;
    }
  }
}

test("doctor reports dry-run apply readiness when the mesh is installed but okx CLI is missing", async () => {
  const previousPath = process.env.PATH;

  try {
    process.env.PATH = "/usr/bin:/bin";
    await withTempHome(null, async () => {
      const report = await runDoctor();

      assert.equal(report.executionReadiness, "can_dry_run_apply");
      assert.equal(report.planReadiness, "degraded");
      assert.equal(report.applyReadiness, "ready");
      assert.equal(report.executeReadiness, "degraded");
      assert.equal(report.capabilitySnapshot.readinessGrade, "C");
      assert.equal(report.capabilitySnapshot.recommendedPlane, "demo");
      assert.ok(report.summary.includes("can dry-run apply"));
    });
  } finally {
    process.env.PATH = previousPath;
  }
});

test("doctor reports okx-only readiness when CLI exists but no executable config is detected", async () => {
  const missingProfilesRoot = join(tmpdir(), `okx-skill-mesh-missing-profiles-${Date.now()}`);

  await withTempHome(null, async () => {
    await withProfilesRoot(missingProfilesRoot, async () => {
      await withMockOkx(await buildReferencePayloads(), async () => {
        const report = await runDoctor();

        assert.equal(report.executionReadiness, "can_dry_run_apply");
        assert.equal(report.planReadiness, "ready");
        assert.equal(report.applyReadiness, "degraded");
        assert.equal(report.executeReadiness, "degraded");
        assert.equal(report.capabilitySnapshot.readinessGrade, "C");
        assert.equal(report.capabilitySnapshot.configExists, false);
        assert.equal(report.capabilitySnapshot.demoProfileLikelyConfigured, false);
        assert.ok(report.summary.includes("Config status: missing"));
      });
    });
  });
});

test("doctor reports non-demo readiness when config exists but demo profile is absent", async () => {
  await withTempHome("[profiles.live]\napiKey = \"live\"\n", async () => {
    await withMockOkx(await buildReferencePayloads(), async () => {
      const report = await runDoctor();

      assert.equal(report.executionReadiness, "can_dry_run_apply");
      assert.equal(report.executeReadiness, "degraded");
      assert.equal(report.capabilitySnapshot.readinessGrade, "B");
      assert.equal(report.capabilitySnapshot.configExists, true);
      assert.equal(report.capabilitySnapshot.demoProfileLikelyConfigured, false);
      assert.equal(report.capabilitySnapshot.recommendedPlane, "live");
      assert.ok(report.summary.includes("Demo profile: not ready"));
    });
  });
});

test("doctor reports demo-executable readiness when CLI and demo profile are both ready", async () => {
  await withTempHome("[profiles.demo]\napiKey = \"demo\"\n", async () => {
    await withMockOkx(await buildReferencePayloads(), async () => {
      const report = await runDoctor();

      assert.equal(report.executionReadiness, "can_execute_on_demo");
      assert.equal(report.executeReadiness, "ready");
      assert.equal(report.capabilitySnapshot.readinessGrade, "A");
      assert.equal(report.capabilitySnapshot.demoProfileLikelyConfigured, true);
      assert.equal(report.capabilitySnapshot.recommendedPlane, "demo");
      assert.ok(report.summary.includes("Mesh state: can execute on demo"));
    });
  });
});

test("skills inspect and graph expose manifest-driven mesh topology", async () => {
  const inspection = await inspectSkill("policy-gate");
  const graph = await describeSkillGraph();

  assert.equal(inspection.skill.stage, "guardrail");
  assert.ok(inspection.skill.allowedExecutionModules.includes("swap"));
  assert.ok(graph.graph.flagshipRoute.includes("policy-gate"));
  assert.ok(graph.summary.includes("portfolio-xray -> market-scan -> trade-thesis"));
});

test("demo orchestrates doctor -> graph -> plan -> apply -> replay in one runtime flow", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = { code: "0", data: [] };
  payloads.accountBalance = {
    code: "0",
    data: [{ details: [{ ccy: "USDT", availBal: "50000", usdEq: "50000" }] }],
  };

  let runId = null;
  await withTempHome("[profiles.demo]\napiKey = \"demo\"\n[profiles.live]\napiKey = \"live\"\n", async () => {
    await withMockOkx(payloads, async () => {
      const session = await runDemo("hedge my btc drawdown with demo first", {
        plane: "demo",
        execute: false,
      });
      runId = session.planned.id;

      assert.equal(session.doctor.executionReadiness, "can_execute_on_demo");
      assert.equal(session.planned.status, "approval_required");
      assert.ok(session.applied.executions.length >= 1);
      assert.equal(session.replayed.trace.at(-1)?.skill, "replay");
      assert.ok(session.summary.includes("TradeMesh CLI Skill Mesh 2.0 Demo"));
      assert.ok(session.summary.includes("TradeMesh Skill Mesh Graph"));
      assert.ok(session.summary.includes("Apply Receipt"));
      assert.ok(session.summary.includes("Replay Timeline"));
    });
  });

  if (runId) {
    await cleanupRunArtifacts(runId);
  }
});
