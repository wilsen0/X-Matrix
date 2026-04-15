import { putArtifact } from "../../runtime/artifacts.js";
import { currentArtifactVersion } from "../../runtime/artifact-schema.js";
import { runOkxProbe } from "../../runtime/okx.js";
import type {
  GoalIntake,
  ProbeReceipt,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";
import runMarketScan from "../market-scan/run.js";

interface ProbeArtifactData {
  probeMode: "passive" | "active" | "write";
  plane: SkillContext["plane"];
  probeReceipts: ProbeReceipt[];
  notes: string[];
}

function symbolsForProbe(context: SkillContext): string[] {
  const fromGoal = context.artifacts.get<GoalIntake>("goal.intake")?.data?.symbols ?? [];
  const fromSnapshot = context.artifacts.get<{ symbols?: string[] }>("portfolio.snapshot")?.data?.symbols ?? [];
  const symbols = [...fromGoal, ...fromSnapshot]
    .map((entry) => entry.toUpperCase())
    .filter(Boolean);
  return symbols.length > 0 ? [...new Set(symbols)] : ["BTC"];
}

function mergeProbeArtifact(existing: ProbeArtifactData | undefined, receipt: ProbeReceipt): ProbeArtifactData {
  return {
    probeMode: existing?.probeMode ?? "active",
    plane: existing?.plane ?? "demo",
    probeReceipts: [...(existing?.probeReceipts ?? []), receipt],
    notes: [...(existing?.notes ?? []), `market probe: ${receipt.ok ? "ok" : "fail"}`],
  };
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const previous = context.artifacts.get<ProbeArtifactData>("diagnostics.probes")?.data;
  const symbol = symbolsForProbe(context)[0] ?? "BTC";
  const receipt = await runOkxProbe("market-read", ["market", "ticker", `${symbol}-USDT`], context.plane);
  const merged = mergeProbeArtifact(previous, receipt);

  putArtifact(context.artifacts, {
    key: "diagnostics.probes",
    version: currentArtifactVersion("diagnostics.probes"),
    producer: context.manifest.name,
    data: merged,
  });

  const marketManifest = context.manifests.find((entry) => entry.name === "market-scan") ?? context.manifest;
  const marketOutput = await runMarketScan({
    ...context,
    manifest: marketManifest,
  });

  return {
    skill: context.manifest.name,
    stage: context.manifest.stage,
    goal: context.goal,
    summary: "Append market probe evidence and refresh market snapshot/regime artifacts.",
    facts: [
      `Probe command: ${receipt.command}`,
      `Probe result: ${receipt.ok ? "ok" : receipt.message ?? "failed"}`,
      ...marketOutput.facts.slice(0, 3),
    ],
    constraints: {
      probeOk: receipt.ok,
      probeDurationMs: receipt.durationMs,
      refreshedBy: "market-scan",
    },
    proposal: [],
    risk: {
      score: 0.08,
      maxLoss: "None",
      needsApproval: false,
      reasons: ["Read-only probe and market snapshot refresh."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["market"],
    },
    handoff: "account-probe",
    producedArtifacts: ["diagnostics.probes", "market.snapshot", "market.regime"],
    consumedArtifacts: ["diagnostics.probes", "goal.intake", "portfolio.snapshot"],
    timestamp: new Date().toISOString(),
  };
}
