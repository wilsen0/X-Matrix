import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDoctor } from "../dist/runtime/doctor.js";

async function withTempHome(fn) {
  const dir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-doctor-strict-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = dir;
    return await fn();
  } finally {
    process.env.HOME = previousHome;
    await rm(dir, { recursive: true, force: true });
  }
}

async function withNoOkxPath(fn) {
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = "/nonexistent";
    return await fn();
  } finally {
    process.env.PATH = previousPath;
  }
}

test("doctor strict gate fails execute target when execute readiness is not ready", async () => {
  await withNoOkxPath(async () => {
    await withTempHome(async () => {
      const report = await runDoctor({
        probeMode: "passive",
        plane: "demo",
        strict: true,
        strictTarget: "execute",
      });
      assert.equal(report.strictTarget, "execute");
      assert.equal(report.strictPass, false);
      assert.notEqual(report.executeReadiness, "ready");
    });
  });
});

test("doctor active probe writes reasonCode and nextActionCmd for failed probes", async () => {
  await withNoOkxPath(async () => {
    await withTempHome(async () => {
      const report = await runDoctor({
        probeMode: "active",
        plane: "demo",
        strict: true,
        strictTarget: "apply",
      });
      const marketProbe = report.probeReceipts.find((entry) => entry.module === "market-read");
      const accountProbe = report.probeReceipts.find((entry) => entry.module === "account-read");

      assert.ok(marketProbe);
      assert.ok(accountProbe);
      assert.equal(marketProbe.ok, false);
      assert.equal(accountProbe.ok, false);
      assert.equal(marketProbe.reasonCode, "cli_missing");
      assert.equal(accountProbe.reasonCode, "cli_missing");
      assert.ok(marketProbe.nextActionCmd?.includes("doctor --probe active --plane demo"));
      assert.ok(accountProbe.nextActionCmd?.includes("doctor --probe active --plane demo"));

      const catalogCodes = report.reasonCatalog.items.map((item) => item.reasonCode);
      assert.ok(catalogCodes.includes("cli_missing"));
      assert.ok(report.reasonCatalog.items.every((item) => typeof item.nextActionCmd === "string"));
    });
  });
});
