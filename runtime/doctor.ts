import process from "node:process";
import { inspectOkxEnvironment } from "./okx.js";
import { getProjectPaths } from "./paths.js";
import { loadSkillRegistry } from "./registry.js";
import type { CapabilitySnapshot } from "./types.js";

export interface DoctorReport {
  ok: boolean;
  summary: string;
  projectRoot: string;
  nodeVersion: string;
  skillCount: number;
  capabilitySnapshot: CapabilitySnapshot;
  recommendations: string[];
}

export async function runDoctor(): Promise<DoctorReport> {
  const paths = getProjectPaths();
  const [skills, capabilitySnapshot] = await Promise.all([loadSkillRegistry(), inspectOkxEnvironment()]);
  const recommendations = [
    "Prefer ~/.okx/config.toml for real environments; use project profiles/ only for local development scaffolding.",
    "Prefer apply without --execute first to validate policy and intents.",
    "Only use --execute --approve after reviewing the selected proposal intents.",
    "When schema-breaking runtime changes land in development, archive local run state with `pnpm archive:dev-state` before re-planning.",
  ];
  const ok =
    capabilitySnapshot.okxCliAvailable &&
    capabilitySnapshot.configExists &&
    capabilitySnapshot.demoProfileLikelyConfigured;

  const summary = [
    `Project root: ${paths.projectRoot}`,
    `Node: ${process.version}`,
    `Skills installed: ${skills.length}`,
    `OKX CLI detected: ${capabilitySnapshot.okxCliAvailable ? "yes" : "no"}`,
    `Profiles: demo=${capabilitySnapshot.demoProfileLikelyConfigured ? "yes" : "no"}, live=${capabilitySnapshot.liveProfileLikelyConfigured ? "yes" : "no"}`,
    `Config path: ${capabilitySnapshot.configPath}`,
    capabilitySnapshot.warnings.length > 0
      ? `Warnings: ${capabilitySnapshot.warnings.join(" | ")}`
      : "Warnings: none",
  ].join("\n");

  return {
    ok,
    summary,
    projectRoot: paths.projectRoot,
    nodeVersion: process.version,
    skillCount: skills.length,
    capabilitySnapshot,
    recommendations,
  };
}
