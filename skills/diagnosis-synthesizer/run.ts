import { putArtifact } from "../../runtime/artifacts.js";
import { currentArtifactVersion } from "../../runtime/artifact-schema.js";
import type {
  CapabilitySnapshot,
  EnvironmentDiagnosis,
  ProbeModuleStatus,
  ProbeReceipt,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";

interface ProbeArtifactData {
  probeMode: "passive" | "active" | "write";
  plane: SkillContext["plane"];
  capabilitySnapshot?: CapabilitySnapshot;
  probeReceipts: ProbeReceipt[];
  notes: string[];
}

function moduleStatus(
  module: ProbeModuleStatus["module"],
  status: ProbeModuleStatus["status"],
  reason: string,
  evidence: string[],
  nextAction: string,
): ProbeModuleStatus {
  return { module, status, reason, evidence, nextAction };
}

function receiptStatus(receipt: ProbeReceipt | undefined): ProbeModuleStatus["status"] {
  if (!receipt) {
    return "degraded";
  }
  return receipt.ok ? "ready" : "blocked";
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const probes = context.artifacts.require<ProbeArtifactData>("diagnostics.probes").data;
  const capabilitySnapshot =
    probes.capabilitySnapshot ??
    (context.runtimeInput.capabilitySnapshot as CapabilitySnapshot | undefined) ?? {
      okxCliAvailable: false,
      configPath: "profiles",
      configExists: false,
      demoProfileLikelyConfigured: false,
      liveProfileLikelyConfigured: false,
      readinessGrade: "D",
      blockers: ["Capability snapshot missing."],
      recommendedPlane: "research",
      warnings: ["Capability snapshot missing."],
    };
  const marketReceipt = probes.probeReceipts.find((entry) => entry.module === "market-read");
  const accountReceipt = probes.probeReceipts.find((entry) => entry.module === "account-read");
  const modules: ProbeModuleStatus[] = [
    moduleStatus(
      "runtime",
      "ready",
      "Runtime state was captured.",
      [`Plane=${probes.plane}`],
      "No action required.",
    ),
    moduleStatus(
      "skills",
      "ready",
      "Probe skill chain executed.",
      ["env-probe -> market-probe -> account-probe -> diagnosis-synthesizer"],
      "No action required.",
    ),
    moduleStatus(
      "okx-cli",
      capabilitySnapshot.okxCliAvailable ? "ready" : "blocked",
      capabilitySnapshot.okxCliAvailable ? "okx CLI detected." : "okx CLI missing.",
      capabilitySnapshot.okxCliAvailable ? [capabilitySnapshot.okxCliPath ?? "path unavailable"] : ["PATH lookup failed."],
      capabilitySnapshot.okxCliAvailable ? "No action required." : "Install okx CLI and rerun probe.",
    ),
    moduleStatus(
      "config",
      capabilitySnapshot.configExists ? "ready" : "blocked",
      capabilitySnapshot.configExists ? "Config available." : "Config missing.",
      [`Config path: ${capabilitySnapshot.configPath}`],
      capabilitySnapshot.configExists ? "No action required." : "Create ~/.okx/config.toml or profiles directory.",
    ),
    moduleStatus(
      "profiles",
      probes.plane === "demo" && !capabilitySnapshot.demoProfileLikelyConfigured
        ? "degraded"
        : probes.plane === "live" && !capabilitySnapshot.liveProfileLikelyConfigured
          ? "degraded"
          : "ready",
      "Profile availability checked from capability snapshot.",
      [`demo=${capabilitySnapshot.demoProfileLikelyConfigured} live=${capabilitySnapshot.liveProfileLikelyConfigured}`],
      "Configure target plane profile if degraded.",
    ),
    moduleStatus(
      "market-read",
      receiptStatus(marketReceipt),
      marketReceipt?.message ?? "Market read probe completed.",
      marketReceipt ? [marketReceipt.command] : ["No market probe receipt."],
      marketReceipt?.ok ? "No action required." : "Fix market read and rerun probe.",
    ),
    moduleStatus(
      "account-read",
      receiptStatus(accountReceipt),
      accountReceipt?.message ?? "Account read probe completed.",
      accountReceipt ? [accountReceipt.command] : ["No account probe receipt."],
      accountReceipt?.ok ? "No action required." : "Fix account read and rerun probe.",
    ),
    moduleStatus(
      "write-path",
      probes.plane === "demo" && capabilitySnapshot.demoProfileLikelyConfigured ? "ready" : "degraded",
      "Write-path readiness inferred from plane and profile setup.",
      [`probeMode=${probes.probeMode}`],
      "Use `trademesh rehearse demo --execute` for controlled write rehearsal.",
    ),
  ];
  const diagnosis: EnvironmentDiagnosis = {
    probeMode: probes.probeMode,
    plane: probes.plane,
    strictTarget: "apply",
    strictPass: modules.every((entry) => entry.status !== "blocked"),
    modules,
    probeReceipts: probes.probeReceipts,
  };

  putArtifact(context.artifacts, {
    key: "diagnostics.readiness",
    version: currentArtifactVersion("diagnostics.readiness"),
    producer: context.manifest.name,
    data: diagnosis,
  });
  putArtifact(context.artifacts, {
    key: "diagnostics.reason-catalog",
    version: currentArtifactVersion("diagnostics.reason-catalog"),
    producer: context.manifest.name,
    data: {
      probeMode: probes.probeMode,
      plane: probes.plane,
      generatedAt: new Date().toISOString(),
      items: probes.probeReceipts
        .filter((receipt) => !receipt.ok)
        .map((receipt) => ({
          module: receipt.module,
          reasonCode: receipt.reasonCode ?? "unknown",
          message: receipt.message ?? (receipt.stderr || "probe failed"),
          nextActionCmd: receipt.nextActionCmd,
        })),
    },
  });

  return {
    skill: context.manifest.name,
    stage: context.manifest.stage,
    goal: context.goal,
    summary: "Synthesize module-level readiness diagnosis from probe receipts.",
    facts: modules.map((entry) => `${entry.module}: ${entry.status}`),
    constraints: {
      probeMode: probes.probeMode,
      moduleCount: modules.length,
      blockedModules: modules.filter((entry) => entry.status === "blocked").map((entry) => entry.module),
    },
    proposal: [],
    risk: {
      score: 0.1,
      maxLoss: "None",
      needsApproval: false,
      reasons: ["Diagnosis synthesis is read-only."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["account", "market"],
    },
    handoff: "rehearsal-planner",
    producedArtifacts: ["diagnostics.readiness", "diagnostics.reason-catalog"],
    consumedArtifacts: ["diagnostics.probes"],
    timestamp: new Date().toISOString(),
  };
}
