import process from "node:process";
import { inspectOkxEnvironment, runOkxProbe } from "./okx.js";
import { getProjectPaths } from "./paths.js";
import { loadSkillRegistry } from "./registry.js";
import { resolveContractAddress } from "./official-skill-adapter.js";
import type {
  CapabilitySnapshot,
  DoctorStrictTarget,
  EnvironmentDiagnosis,
  ExecutionPlane,
  ProbeMode,
  ProbeReasonCatalog,
  ProbeReasonCatalogEntry,
  ProbeModuleName,
  ProbeModuleStatus,
  ProbeReceipt,
} from "./types.js";

type ExecutionReadiness =
  | "can_plan_only"
  | "can_dry_run_apply"
  | "can_execute_on_demo"
  | "cannot_execute";

const PLANNING_PACK = [
  "portfolio-xray",
  "market-scan",
  "trade-thesis",
  "hedge-planner",
  "scenario-sim",
  "policy-gate",
];
const APPLY_PACK = [
  ...PLANNING_PACK,
  "approval-gate",
  "live-guard",
  "idempotency-gate",
  "official-executor",
  "operator-summarizer",
  "replay",
];

export interface RunDoctorOptions {
  probeMode?: ProbeMode;
  plane?: ExecutionPlane;
  strict?: boolean;
  strictTarget?: DoctorStrictTarget;
}

export interface DoctorReport {
  ok: boolean;
  summary: string;
  projectRoot: string;
  nodeVersion: string;
  skillCount: number;
  capabilitySnapshot: CapabilitySnapshot;
  planReadiness: "ready" | "degraded" | "blocked";
  applyReadiness: "ready" | "degraded" | "blocked";
  executeReadiness: "ready" | "degraded" | "blocked";
  executionReadiness: ExecutionReadiness;
  missingSkills: string[];
  recommendations: string[];
  strictTarget: DoctorStrictTarget;
  strictPass: boolean;
  probeMode: ProbeMode;
  modules: ProbeModuleStatus[];
  probeReceipts: ProbeReceipt[];
  reasonCatalog: ProbeReasonCatalog;
  diagnosis: EnvironmentDiagnosis;
}

function section(title: string, lines: string[]): string {
  return [`== ${title} ==`, ...lines, ""].join("\n");
}

function computeExecutionReadiness(
  skillNames: string[],
  capabilitySnapshot: CapabilitySnapshot,
): {
  readiness: ExecutionReadiness;
  missingSkills: string[];
} {
  const installed = new Set(skillNames);
  const missingPlanning = PLANNING_PACK.filter((name) => !installed.has(name));
  const missingApply = APPLY_PACK.filter((name) => !installed.has(name));

  if (
    missingApply.length === 0 &&
    capabilitySnapshot.okxCliAvailable &&
    capabilitySnapshot.configExists &&
    capabilitySnapshot.demoProfileLikelyConfigured
  ) {
    return {
      readiness: "can_execute_on_demo",
      missingSkills: [],
    };
  }

  if (missingApply.length === 0) {
    return {
      readiness: "can_dry_run_apply",
      missingSkills: [],
    };
  }

  if (missingPlanning.length === 0) {
    return {
      readiness: "can_plan_only",
      missingSkills: missingApply,
    };
  }

  return {
    readiness: "cannot_execute",
    missingSkills: missingPlanning,
  };
}

function readinessLabel(readiness: ExecutionReadiness): string {
  if (readiness === "can_execute_on_demo") {
    return "can execute on demo";
  }
  if (readiness === "can_dry_run_apply") {
    return "can dry-run apply";
  }
  if (readiness === "can_plan_only") {
    return "can plan only";
  }
  return "cannot execute";
}

function phaseReadiness(
  skillNames: string[],
  capabilitySnapshot: CapabilitySnapshot,
): Pick<DoctorReport, "planReadiness" | "applyReadiness" | "executeReadiness"> {
  const installed = new Set(skillNames);
  const missingPlanning = PLANNING_PACK.filter((name) => !installed.has(name));
  const missingApply = APPLY_PACK.filter((name) => !installed.has(name));

  const planReadiness: DoctorReport["planReadiness"] =
    missingPlanning.length > 0 ? "blocked" : capabilitySnapshot.okxCliAvailable ? "ready" : "degraded";
  const applyReadiness: DoctorReport["applyReadiness"] =
    missingApply.length > 0 ? "blocked" : capabilitySnapshot.configExists ? "ready" : "degraded";
  const executeReadiness: DoctorReport["executeReadiness"] =
    missingApply.length > 0
      ? "blocked"
      : capabilitySnapshot.okxCliAvailable &&
          capabilitySnapshot.configExists &&
          capabilitySnapshot.demoProfileLikelyConfigured
        ? "ready"
        : "degraded";

  return {
    planReadiness,
    applyReadiness,
    executeReadiness,
  };
}

function moduleStatus(
  module: ProbeModuleName,
  status: ProbeModuleStatus["status"],
  reason: string,
  evidence: string[],
  nextAction: string,
): ProbeModuleStatus {
  return {
    module,
    status,
    reason,
    evidence,
    nextAction,
  };
}

function profileStatus(snapshot: CapabilitySnapshot, plane: ExecutionPlane): ProbeModuleStatus {
  if (!snapshot.configExists) {
    return moduleStatus(
      "profiles",
      "blocked",
      "No executable config/profiles were found.",
      [`Config path: ${snapshot.configPath}`],
      "Create ~/.okx/config.toml or local profiles and rerun doctor.",
    );
  }

  if (plane === "demo" && !snapshot.demoProfileLikelyConfigured) {
    return moduleStatus(
      "profiles",
      "degraded",
      "Demo profile markers were not detected.",
      ["Demo profile: missing"],
      "Configure a demo profile before execute on demo plane.",
    );
  }

  if (plane === "live" && !snapshot.liveProfileLikelyConfigured) {
    return moduleStatus(
      "profiles",
      "degraded",
      "Live profile markers were not detected.",
      ["Live profile: missing"],
      "Configure a live profile before execute on live plane.",
    );
  }

  return moduleStatus(
    "profiles",
    "ready",
    "Profiles look usable for the selected plane.",
    [`Plane=${plane}`],
    "No action required.",
  );
}

function probeResultToStatus(
  module: ProbeModuleName,
  receipt: ProbeReceipt | undefined,
  passiveReason: string,
  passiveAction: string,
): ProbeModuleStatus {
  if (!receipt) {
    return moduleStatus(module, "degraded", passiveReason, [], passiveAction);
  }

  if (receipt.ok) {
    return moduleStatus(
      module,
      "ready",
      "Probe command succeeded.",
      [`${receipt.command} (${receipt.durationMs}ms)`],
      "No action required.",
    );
  }

  return moduleStatus(
    module,
    "blocked",
    receipt.message ?? "Probe command failed.",
    [`${receipt.command} (${receipt.durationMs}ms)`, `reasonCode=${receipt.reasonCode ?? "unknown"}`],
    receipt.nextActionCmd ?? "Resolve command failure and rerun doctor --probe active.",
  );
}

function writePathStatus(
  probeMode: ProbeMode,
  plane: ExecutionPlane,
  snapshot: CapabilitySnapshot,
  skillNames: string[],
): ProbeModuleStatus {
  const installed = new Set(skillNames);
  const missingApply = APPLY_PACK.filter((name) => !installed.has(name));

  if (missingApply.length > 0) {
    return moduleStatus(
      "write-path",
      "blocked",
      "Required apply path skills are missing.",
      [`Missing: ${missingApply.join(", ")}`],
      "Install missing skills before apply/execute.",
    );
  }

  if (plane === "research") {
    return moduleStatus(
      "write-path",
      "blocked",
      "Research plane blocks write intents by policy.",
      ["Plane=research"],
      "Switch to demo plane for rehearsals.",
    );
  }

  if (plane === "demo" && !snapshot.demoProfileLikelyConfigured) {
    return moduleStatus(
      "write-path",
      "degraded",
      "Demo profile is not ready for write rehearsals.",
      ["Demo profile: missing"],
      "Configure demo profile and rerun doctor.",
    );
  }

  if (probeMode === "write") {
    return moduleStatus(
      "write-path",
      "ready",
      "Write-path preflight passed (no write command executed).",
      ["Use `trademesh rehearse demo --execute` for controlled execution rehearsal."],
      "No action required.",
    );
  }

  return moduleStatus(
    "write-path",
    "degraded",
    "Write-path probe is available but not executed in this mode.",
    [`probeMode=${probeMode}`],
    "Use --probe write or rehearse demo to validate write path.",
  );
}

function walletStatus(
  skillNames: string[],
  probeMode: ProbeMode,
): ProbeModuleStatus {
  const hasWalletSkill = skillNames.includes("agent-wallet");
  if (!hasWalletSkill) {
    return moduleStatus(
      "agent-wallet",
      "degraded",
      "agent-wallet skill is not installed.",
      ["Skill: agent-wallet missing"],
      "Install the agent-wallet skill for on-chain wallet routing.",
    );
  }

  const envWallet = process.env.SKILLS_MESH_AGENT_WALLET;
  if (typeof envWallet === "string" && envWallet.trim().length > 0) {
    return moduleStatus(
      "agent-wallet",
      "ready",
      "Agent wallet resolved via environment variable.",
      ["Skill: installed", `Env: SKILLS_MESH_AGENT_WALLET set (${envWallet.trim().slice(0, 10)}…)`],
      "No action required.",
    );
  }

  if (probeMode === "passive") {
    return moduleStatus(
      "agent-wallet",
      "ready",
      "agent-wallet skill is installed; will fall back to demo/research wallet at runtime.",
      ["Skill: installed", "Env: not set (demo fallback available)"],
      "Set SKILLS_MESH_AGENT_WALLET for live wallet routing.",
    );
  }

  return moduleStatus(
    "agent-wallet",
    "ready",
    "agent-wallet skill is installed and available.",
    ["Skill: installed"],
    "No action required.",
  );
}

function xlayerChainStatus(
  skillNames: string[],
): ProbeModuleStatus {
  const hasWalletSkill = skillNames.includes("agent-wallet");
  if (!hasWalletSkill) {
    return moduleStatus(
      "xlayer-chain",
      "degraded",
      "X Layer chain routing depends on agent-wallet skill.",
      ["Dependency: agent-wallet not installed"],
      "Install agent-wallet skill to enable X Layer routing.",
    );
  }

  return moduleStatus(
    "xlayer-chain",
    "ready",
    "X Layer is the default chain target for on-chain routing.",
    ["Chain: xlayer (default)"],
    "No action required.",
  );
}

function officialSkillStatus(
  skillNames: string[],
): ProbeModuleStatus {
  const hasExecutor = skillNames.includes("official-executor");
  if (!hasExecutor) {
    return moduleStatus(
      "official-skill",
      "blocked",
      "official-executor skill is not installed; write path unavailable.",
      ["Skill: official-executor missing"],
      "Install official-executor to enable the sole write path.",
    );
  }

  const hasWallet = skillNames.includes("agent-wallet");
  const hasAdapter = true; // official-skill-adapter is a runtime module, always available
  const evidence: string[] = [
    "Executor: installed",
  ];
  if (hasWallet) {
    evidence.push("Wallet routing: enabled");
  }
  if (hasAdapter) {
    evidence.push("Adapter: runtime module present");
  }

  return moduleStatus(
    "official-skill",
    "ready",
    "Official skill adapter layer is available.",
    evidence,
    "No action required.",
  );
}

function onchainProfileStatus(
  skillNames: string[],
): ProbeModuleStatus {
  const hasExecutor = skillNames.includes("official-executor");
  if (!hasExecutor) {
    return moduleStatus(
      "onchain-profile",
      "blocked",
      "Cannot assess onchain profile readiness without official-executor.",
      ["Dependency: official-executor missing"],
      "Install official-executor to enable onchain profile diagnostics.",
    );
  }

  // Check contract address configuration for primary write methods
  const writeMethods = ["swap-place-order", "option-place-order"];
  const resolutions = writeMethods.map((method) => resolveContractAddress("xlayer", method));
  const configured = resolutions.filter((r) => r.configured);
  const unconfigured = resolutions.filter((r) => !r.configured);

  const evidence: string[] = [
    `Payload extraction: enabled (parsed from command args)`,
    `Contract methods checked: ${writeMethods.join(", ")}`,
    ...resolutions.map((r) => `${r.method}: ${r.configured ? `configured (${r.source})` : `not configured (${r.source})`}`),
  ];

  if (unconfigured.length === 0) {
    return moduleStatus(
      "onchain-profile",
      "ready",
      "All onchain contract addresses are configured.",
      evidence,
      "No action required.",
    );
  }

  return moduleStatus(
    "onchain-profile",
    "degraded",
    "Onchain contract addresses are not configured — protocol is ready but execution is placeholder-only.",
    evidence,
    `Set ${unconfigured.map((r) => r.source.split(" ")[0]).join(", ")} to enable real on-chain execution.`,
  );
}

function moduleLines(modules: ProbeModuleStatus[]): string[] {
  return modules.map((entry) => `${entry.module}: ${entry.status} | ${entry.reason}`);
}

function receiptLines(receipts: ProbeReceipt[]): string[] {
  if (receipts.length === 0) {
    return ["No probe commands executed."];
  }

  return receipts.map((receipt) =>
    `${receipt.module}: ${receipt.ok ? "ok" : "fail"} | ${receipt.command} | ${receipt.durationMs}ms`,
  );
}

async function runProbeReceipts(mode: ProbeMode, plane: ExecutionPlane): Promise<ProbeReceipt[]> {
  if (mode === "passive") {
    return [];
  }

  const receipts: ProbeReceipt[] = [];
  receipts.push(runOkxProbe("market-read", ["market", "ticker", "BTC-USDT"], plane));
  receipts.push(runOkxProbe("account-read", ["account", "balance"], plane));
  if (mode === "write") {
    receipts.push(runOkxProbe("write-path", ["account", "positions"], plane));
  }

  return receipts;
}

function readStrictTarget(value: DoctorStrictTarget): "planReadiness" | "applyReadiness" | "executeReadiness" {
  if (value === "plan") {
    return "planReadiness";
  }
  if (value === "execute") {
    return "executeReadiness";
  }
  return "applyReadiness";
}

function buildReasonCatalog(
  probeMode: ProbeMode,
  plane: ExecutionPlane,
  receipts: ProbeReceipt[],
): ProbeReasonCatalog {
  const items: ProbeReasonCatalogEntry[] = receipts
    .filter((receipt) => !receipt.ok)
    .map((receipt) => ({
      module: receipt.module,
      reasonCode: receipt.reasonCode ?? "unknown",
      message: receipt.message ?? (receipt.stderr || "probe failed"),
      nextActionCmd: receipt.nextActionCmd,
    }));
  return {
    probeMode,
    plane,
    generatedAt: new Date().toISOString(),
    items,
  };
}

export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorReport> {
  const probeMode: ProbeMode = options.probeMode ?? "passive";
  const plane: ExecutionPlane = options.plane ?? "demo";
  const strictEnabled = options.strict === true;
  const strictTarget: DoctorStrictTarget = options.strictTarget ?? "apply";
  const paths = getProjectPaths();
  const [skills, capabilitySnapshot] = await Promise.all([loadSkillRegistry(), inspectOkxEnvironment()]);
  const skillNames = skills.map((skill) => skill.name);
  const readiness = computeExecutionReadiness(skillNames, capabilitySnapshot);
  const phaseState = phaseReadiness(skillNames, capabilitySnapshot);
  const probeReceipts = await runProbeReceipts(probeMode, plane);
  const reasonCatalog = buildReasonCatalog(probeMode, plane, probeReceipts);
  const marketReceipt = probeReceipts.find((entry) => entry.module === "market-read");
  const accountReceipt = probeReceipts.find((entry) => entry.module === "account-read");
  const modules: ProbeModuleStatus[] = [
    moduleStatus(
      "runtime",
      "ready",
      "Runtime core is reachable.",
      [`Project root: ${paths.projectRoot}`, `Node: ${process.version}`],
      "No action required.",
    ),
    moduleStatus(
      "skills",
      readiness.missingSkills.length > 0 ? "degraded" : "ready",
      readiness.missingSkills.length > 0
        ? "Some flagship skills are missing."
        : "Flagship skills are installed.",
      readiness.missingSkills.length > 0 ? [`Missing: ${readiness.missingSkills.join(", ")}`] : ["All required skills installed."],
      readiness.missingSkills.length > 0
        ? "Install missing skills and rerun doctor."
        : "No action required.",
    ),
    moduleStatus(
      "okx-cli",
      capabilitySnapshot.okxCliAvailable ? "ready" : "blocked",
      capabilitySnapshot.okxCliAvailable ? "okx CLI detected." : "okx CLI missing on PATH.",
      capabilitySnapshot.okxCliAvailable ? [`Path: ${capabilitySnapshot.okxCliPath ?? "unknown"}`] : ["PATH lookup failed."],
      capabilitySnapshot.okxCliAvailable ? "No action required." : "Install okx CLI and ensure it is on PATH.",
    ),
    moduleStatus(
      "config",
      capabilitySnapshot.configExists ? "ready" : "blocked",
      capabilitySnapshot.configExists ? "Config path is present." : "Config/profiles path missing.",
      [`Config path: ${capabilitySnapshot.configPath}`],
      capabilitySnapshot.configExists
        ? "No action required."
        : "Create ~/.okx/config.toml or profiles/ before executing.",
    ),
    profileStatus(capabilitySnapshot, plane),
    probeResultToStatus(
      "market-read",
      marketReceipt,
      "Market probe skipped in passive mode.",
      "Use --probe active to run market read probes.",
    ),
    probeResultToStatus(
      "account-read",
      accountReceipt,
      "Account probe skipped in passive mode.",
      "Use --probe active to run account read probes.",
    ),
    writePathStatus(probeMode, plane, capabilitySnapshot, skillNames),
    walletStatus(skillNames, probeMode),
    xlayerChainStatus(skillNames),
    officialSkillStatus(skillNames),
    onchainProfileStatus(skillNames),
  ];
  const diagnosis: EnvironmentDiagnosis = {
    probeMode,
    plane,
    strictTarget,
    strictPass: phaseState[readStrictTarget(strictTarget)] === "ready",
    modules,
    probeReceipts,
  };
  const strictPass = diagnosis.strictPass;

  const recommendations = [
    ...(readiness.missingSkills.length > 0
      ? [`Install the missing flagship skills: ${readiness.missingSkills.join(", ")}.`]
      : []),
    ...(!capabilitySnapshot.okxCliAvailable ? ["Install `okx` CLI and ensure it is on PATH."] : []),
    ...(!capabilitySnapshot.configExists ? ["Create ~/.okx/config.toml or keep project profiles/ for local development."] : []),
    ...(!capabilitySnapshot.demoProfileLikelyConfigured
      ? ["Configure a demo profile before attempting `--execute` on the demo plane."]
      : []),
    probeMode === "passive"
      ? "Run `trademesh doctor --probe active` for runtime read-path validation."
      : "Use `trademesh rehearse demo` to validate policy + executor with deterministic rehearsal flow.",
    "Prefer apply without --execute first to validate policy and execution intents.",
    ...(strictEnabled && !strictPass
      ? [`Doctor strict gate failed for target '${strictTarget}'. Resolve blockers and rerun doctor.`]
      : []),
  ];
  const ok = readiness.readiness !== "cannot_execute" && (!strictEnabled || strictPass);

  const summary = [
    "TradeMesh CLI Skill Mesh 2.0",
    `Project root: ${paths.projectRoot}`,
    `Node: ${process.version}`,
    "",
    section("Runtime Readiness", [
      `Probe mode: ${probeMode}`,
      `Probe plane: ${plane}`,
      `Overall grade: ${capabilitySnapshot.readinessGrade}`,
      `Plan readiness: ${phaseState.planReadiness}`,
      `Apply readiness: ${phaseState.applyReadiness}`,
      `Execute readiness: ${phaseState.executeReadiness}`,
      `Strict gate: target=${strictTarget} pass=${strictPass ? "yes" : "no"}`,
      `Mesh state: ${readinessLabel(readiness.readiness)}`,
      `Executable plane recommendation: ${capabilitySnapshot.recommendedPlane}`,
      `Skills installed: ${skills.length}`,
      `Missing flagship skills: ${readiness.missingSkills.length > 0 ? readiness.missingSkills.join(", ") : "none"}`,
    ]),
    section("Health Modules", moduleLines(modules)),
    section("Probe Receipts", receiptLines(probeReceipts)),
    section("Blockers And Remedies", [
      ...(capabilitySnapshot.blockers.length > 0
        ? capabilitySnapshot.blockers.map((blocker) => `blocker: ${blocker}`)
        : ["blocker: none"]),
      ...(capabilitySnapshot.warnings.length > 0
        ? capabilitySnapshot.warnings.map((warning) => `warning: ${warning}`)
        : ["warning: none"]),
      ...recommendations.slice(0, 4).map((item) => `remedy: ${item}`),
    ]),
  ].join("\n");

  return {
    ok,
    summary,
    projectRoot: paths.projectRoot,
    nodeVersion: process.version,
    skillCount: skills.length,
    capabilitySnapshot,
    planReadiness: phaseState.planReadiness,
    applyReadiness: phaseState.applyReadiness,
    executeReadiness: phaseState.executeReadiness,
    executionReadiness: readiness.readiness,
    missingSkills: readiness.missingSkills,
    recommendations,
    strictTarget,
    strictPass,
    probeMode,
    modules,
    probeReceipts,
    reasonCatalog,
    diagnosis,
  };
}
