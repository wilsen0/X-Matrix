import { putArtifact } from "../../runtime/artifacts.js";
import { currentArtifactVersion } from "../../runtime/artifact-schema.js";
import { runOkxProbe } from "../../runtime/okx.js";
import type {
  ProbeReceipt,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";
import runPortfolioXray from "../portfolio-xray/run.js";

interface ProbeArtifactData {
  probeMode: "passive" | "active" | "write";
  plane: SkillContext["plane"];
  probeReceipts: ProbeReceipt[];
  notes: string[];
}

function mergeProbeArtifact(existing: ProbeArtifactData | undefined, receipt: ProbeReceipt): ProbeArtifactData {
  return {
    probeMode: existing?.probeMode ?? "active",
    plane: existing?.plane ?? "demo",
    probeReceipts: [...(existing?.probeReceipts ?? []), receipt],
    notes: [...(existing?.notes ?? []), `account probe: ${receipt.ok ? "ok" : "fail"}`],
  };
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const previous = context.artifacts.get<ProbeArtifactData>("diagnostics.probes")?.data;
  const receipt = await runOkxProbe("account-read", ["account", "balance"], context.plane);
  const merged = mergeProbeArtifact(previous, receipt);

  putArtifact(context.artifacts, {
    key: "diagnostics.probes",
    version: currentArtifactVersion("diagnostics.probes"),
    producer: context.manifest.name,
    data: merged,
  });

  const xrayManifest = context.manifests.find((entry) => entry.name === "portfolio-xray") ?? context.manifest;
  const xrayOutput = await runPortfolioXray({
    ...context,
    manifest: xrayManifest,
  });

  return {
    skill: context.manifest.name,
    stage: context.manifest.stage,
    goal: context.goal,
    summary: "Append account probe evidence and refresh goal + portfolio artifacts.",
    facts: [
      `Probe command: ${receipt.command}`,
      `Probe result: ${receipt.ok ? "ok" : receipt.message ?? "failed"}`,
      ...xrayOutput.facts.slice(0, 3),
    ],
    constraints: {
      probeOk: receipt.ok,
      probeDurationMs: receipt.durationMs,
      refreshedBy: "portfolio-xray",
    },
    proposal: [],
    risk: {
      score: 0.08,
      maxLoss: "None",
      needsApproval: false,
      reasons: ["Read-only probe and portfolio snapshot refresh."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["account"],
    },
    handoff: "diagnosis-synthesizer",
    producedArtifacts: ["diagnostics.probes", "goal.intake", "portfolio.snapshot", "portfolio.risk-profile"],
    consumedArtifacts: ["diagnostics.probes"],
    timestamp: new Date().toISOString(),
  };
}
