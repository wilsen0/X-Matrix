import { putArtifact } from "../../runtime/artifacts.js";
import type {
  ArtifactKey,
  RouteProof,
  RouteProofMinimality,
  RouteProofStep,
  SkillCertificationItem,
  SkillCertificationReport,
  SkillContext,
  SkillManifest,
  SkillOutput,
} from "../../runtime/types.js";

interface SkippedStepLike {
  skill?: string;
  produces?: ArtifactKey[];
}

function now(): string {
  return new Date().toISOString();
}

function quoteGoal(goal: string): string {
  return goal.replace(/"/g, '\\"');
}

function asRoute(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function asArtifactKeys(value: unknown): ArtifactKey[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is ArtifactKey => typeof entry === "string" && entry.trim().length > 0);
}

function asSkippedSteps(value: unknown): SkippedStepLike[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      skill: typeof entry.skill === "string" ? entry.skill : undefined,
      produces: asArtifactKeys(entry.produces),
    }))
    .filter((entry) => typeof entry.skill === "string");
}

function routeKind(value: unknown): RouteProof["routeKind"] {
  if (value === "workflow" || value === "standalone" || value === "operations") {
    return value;
  }
  return "workflow";
}

function certificationMap(context: SkillContext): Map<string, SkillCertificationItem> {
  const report = context.artifacts.get<SkillCertificationReport>("mesh.skill-certification")?.data;
  return new Map((report?.items ?? []).map((item) => [item.skill, item]));
}

function rerunCommand(context: SkillContext, skill: string): string {
  return `node dist/bin/trademesh.js skills run ${skill} "${quoteGoal(context.goal)}" --plane ${context.plane} --input .trademesh/runs/${context.runId}/artifacts.json --skip-satisfied`;
}

function unlockedNext(route: string[], currentIndex: number, manifestsByName: Map<string, SkillManifest>): string[] {
  const current = manifestsByName.get(route[currentIndex]);
  if (!current || current.produces.length === 0) {
    return [];
  }
  const produced = new Set(current.produces);
  const unlocked: string[] = [];
  for (const nextName of route.slice(currentIndex + 1)) {
    const next = manifestsByName.get(nextName);
    if (!next) {
      continue;
    }
    if (next.consumes.some((artifact) => produced.has(artifact))) {
      unlocked.push(nextName);
    }
  }
  return unlocked;
}

function buildMinimality(
  route: string[],
  targetOutputs: ArtifactKey[],
  manifestsByName: Map<string, SkillManifest>,
  steps: RouteProofStep[],
): RouteProofMinimality {
  if (targetOutputs.length === 0) {
    return {
      passed: true,
      redundantSkills: [],
      reason: "No target outputs were declared for this route; minimality check was skipped.",
    };
  }

  const required = new Set<ArtifactKey>(targetOutputs);
  const redundantSkills: string[] = [];

  for (let index = route.length - 1; index >= 0; index -= 1) {
    const skill = route[index];
    const manifest = manifestsByName.get(skill);
    const step = steps[index];
    if (!manifest || !step || step.disposition !== "executed") {
      continue;
    }
    if (manifest.produces.length === 0) {
      continue;
    }

    const producesRequired = manifest.produces.some((artifact) => required.has(artifact));
    const isMemoryTail = manifest.stage === "memory" && !manifest.produces.some((artifact) => targetOutputs.includes(artifact));
    if (!producesRequired && !isMemoryTail) {
      redundantSkills.push(skill);
      continue;
    }

    if (producesRequired) {
      for (const artifact of manifest.consumes) {
        required.add(artifact);
      }
    }
  }

  return {
    passed: redundantSkills.length === 0,
    redundantSkills,
    reason: redundantSkills.length === 0
      ? "All executed skills contribute to the declared target outputs."
      : `Executed route contains redundant skills: ${redundantSkills.join(", ")}.`,
  };
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const route = asRoute(context.runtimeInput.route);
  const targetOutputs = asArtifactKeys(context.runtimeInput.targetOutputs);
  const skipped = new Map(asSkippedSteps(context.runtimeInput.skippedSteps).map((entry) => [entry.skill!, entry]));
  const manifestsByName = new Map(context.manifests.map((manifest) => [manifest.name, manifest]));
  const certificationBySkill = certificationMap(context);
  const missingTargetOutputs = targetOutputs.filter((artifact) => !context.artifacts.has(artifact));

  const steps: RouteProofStep[] = route.map((skill, index) => {
    const manifest = manifestsByName.get(skill);
    const certification = certificationBySkill.get(skill);
    const disposition: RouteProofStep["disposition"] = skipped.has(skill) ? "skipped_satisfied" : "executed";
    const standaloneRunnable = certification?.proofPassed === true ||
      (certification?.rerunnable === true && certification.proofClass === "portable");
    return {
      skill,
      disposition,
      consumes: manifest?.consumes ?? [],
      produces: manifest?.produces ?? skipped.get(skill)?.produces ?? [],
      unlockedNext: unlockedNext(route, index, manifestsByName),
      standaloneRunnable,
      rerunCommand: standaloneRunnable ? rerunCommand(context, skill) : undefined,
      reason: disposition === "skipped_satisfied"
        ? "Skipped because declared outputs were already present in the artifact store."
        : "Executed in the current route.",
    };
  });

  const minimality = buildMinimality(route, targetOutputs, manifestsByName, steps);
  const resumePoints = steps
    .filter((step) => step.standaloneRunnable && step.rerunCommand)
    .map((step) => ({
      skill: step.skill,
      requiredArtifacts: manifestsByName.get(step.skill)?.consumes ?? [],
      rerunCommand: step.rerunCommand!,
    }));

  const proof: RouteProof = {
    runId: context.runId,
    routeKind: routeKind(context.runtimeInput.routeKind),
    route,
    targetOutputs,
    proofPassed: missingTargetOutputs.length === 0 && minimality.passed,
    minimality,
    steps,
    resumePoints,
    generatedAt: now(),
  };

  putArtifact(context.artifacts, {
    key: "mesh.route-proof",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: proof,
  });

  return {
    skill: context.manifest.name,
    stage: context.manifest.stage,
    goal: context.goal,
    summary: "Produce a route proof that explains route minimality, resumability, and standalone rerun points.",
    facts: [
      `Route steps: ${route.length}.`,
      `Target outputs: ${targetOutputs.length}.`,
      `Missing targets: ${missingTargetOutputs.length}.`,
      `Resume points: ${resumePoints.length}.`,
      `Minimality: ${minimality.passed ? "passed" : "failed"}.`,
    ],
    constraints: {
      routeKind: proof.routeKind,
      route,
      targetOutputs,
      missingTargetOutputs,
      redundantSkills: minimality.redundantSkills,
    },
    proposal: [],
    risk: {
      score: proof.proofPassed ? 0.08 : 0.32,
      maxLoss: "No execution is performed by mesh-prover.",
      needsApproval: false,
      reasons: proof.proofPassed
        ? ["Route proof was generated successfully."]
        : [
            missingTargetOutputs.length > 0
              ? `Missing target outputs: ${missingTargetOutputs.join(", ")}.`
              : minimality.reason,
          ],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: null,
    producedArtifacts: ["mesh.route-proof"],
    consumedArtifacts: ["mesh.skill-certification"],
    metadata: {
      routeProof: proof,
    },
    timestamp: now(),
  };
}
