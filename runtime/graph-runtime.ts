import type {
  ArtifactKey,
  ArtifactStore,
  SkillContext,
  SkillManifest,
  SkillOutput,
  SkillStage,
} from "./types.js";
import { shouldSeedManifest, triggerScore } from "./router.js";

const PLANNING_STAGES: SkillStage[] = ["sensor", "planner", "guardrail"];
const STAGE_ORDER: SkillStage[] = ["sensor", "planner", "guardrail", "executor", "memory"];

function stageRank(stage: SkillStage): number {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isPlanningManifest(manifest: SkillManifest): boolean {
  return PLANNING_STAGES.includes(manifest.stage);
}

function dependenciesSatisfied(manifest: SkillManifest, artifacts: ArtifactStore): boolean {
  return manifest.consumes.every((key) => artifacts.has(key));
}

function readinessScore(goal: string, manifest: SkillManifest, artifacts: ArtifactStore): number {
  const producedBonus = manifest.produces.length;
  const preferredBonus = manifest.preferredHandoffs.length > 0 ? 1 : 0;
  const artifactBonus = manifest.consumes.filter((key) => artifacts.has(key)).length;
  return triggerScore(goal, manifest) * 10 + producedBonus * 3 + preferredBonus * 2 + artifactBonus;
}

function pickNextManifest(
  goal: string,
  ready: SkillManifest[],
  lastOutput: SkillOutput | undefined,
  artifacts: ArtifactStore,
): SkillManifest {
  if (lastOutput?.handoff) {
    const preferred = ready.find((manifest) => manifest.name === lastOutput.handoff);
    if (preferred) {
      return preferred;
    }
  }

  const smallestStage = Math.min(...ready.map((manifest) => stageRank(manifest.stage)));
  const sameStage = ready.filter((manifest) => stageRank(manifest.stage) === smallestStage);
  return [...sameStage].sort((left, right) => {
    const scoreDiff = readinessScore(goal, right, artifacts) - readinessScore(goal, left, artifacts);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left.name.localeCompare(right.name);
  })[0];
}

function pendingProduces(manifest: SkillManifest, executedNames: Set<string>, manifests: SkillManifest[]): boolean {
  if (executedNames.has(manifest.name) && !manifest.repeatable) {
    return false;
  }

  if (manifest.consumes.length === 0) {
    return true;
  }

  const potentialProducers = manifests.filter(
    (candidate) =>
      candidate.name !== manifest.name &&
      candidate.produces.some((key) => manifest.consumes.includes(key)) &&
      (!executedNames.has(candidate.name) || candidate.repeatable),
  );

  return potentialProducers.length > 0;
}

export interface PlanningGraphOptions {
  goal: string;
  manifests: SkillManifest[];
  executeSkill: (manifest: SkillManifest, context: Omit<SkillContext, "manifest">) => Promise<SkillOutput>;
  context: Omit<SkillContext, "manifest">;
}

export interface PlanningGraphResult {
  trace: SkillOutput[];
  route: string[];
  skippedSteps: ExplicitRouteSkippedStep[];
}

export interface ExplicitRouteOptions {
  route: string[];
  manifests: SkillManifest[];
  executeSkill: (manifest: SkillManifest, context: Omit<SkillContext, "manifest">) => Promise<SkillOutput>;
  context: Omit<SkillContext, "manifest">;
  skipSatisfied?: boolean;
}

export interface ExplicitRouteSkippedStep {
  skill: string;
  produces: ArtifactKey[];
  reason: "outputs_already_satisfied";
}

export async function runPlanningGraph(options: PlanningGraphOptions): Promise<PlanningGraphResult> {
  const candidates = options.manifests
    .filter(isPlanningManifest)
    .filter((manifest) => shouldSeedManifest(options.goal, manifest));
  const executedCounts = new Map<string, number>();
  const route: string[] = [];
  const trace: SkillOutput[] = [];

  while (true) {
    const ready = candidates.filter((manifest) => {
      const executed = executedCounts.get(manifest.name) ?? 0;
      if (executed > 0 && !manifest.repeatable) {
        return false;
      }
      return dependenciesSatisfied(manifest, options.context.artifacts);
    });

    if (ready.length === 0) {
      break;
    }

    const next = pickNextManifest(options.goal, ready, trace.at(-1), options.context.artifacts);
    const output = await options.executeSkill(next, {
      ...options.context,
      trace,
    });
    trace.push(output);
    route.push(next.name);
    executedCounts.set(next.name, (executedCounts.get(next.name) ?? 0) + 1);
  }

  const executedNames = new Set(route);
  const blockedCandidates = candidates.filter(
    (manifest) =>
      (!executedNames.has(manifest.name) || manifest.repeatable) &&
      !dependenciesSatisfied(manifest, options.context.artifacts) &&
      pendingProduces(manifest, executedNames, candidates),
  );
  if (blockedCandidates.length > 0) {
    const missing = blockedCandidates
      .map((manifest) => {
        const unmet = manifest.consumes.filter((key) => !options.context.artifacts.has(key));
        return `${manifest.name}: missing [${unmet.join(", ")}]`;
      })
      .join("; ");
    throw new Error(`Planning graph could not satisfy skill dependencies: ${missing}`);
  }

  return { trace, route, skippedSteps: [] };
}

export async function runExplicitRoute(options: ExplicitRouteOptions): Promise<PlanningGraphResult> {
  const byName = new Map(options.manifests.map((manifest) => [manifest.name, manifest]));
  const trace: SkillOutput[] = [];
  const route: string[] = [];
  const skippedSteps: ExplicitRouteSkippedStep[] = [];
  const executedCounts = new Map<string, number>();

  for (const skillName of options.route) {
    const manifest = byName.get(skillName);
    if (!manifest) {
      throw new Error(`Explicit route references unknown skill '${skillName}'.`);
    }

    const executed = executedCounts.get(manifest.name) ?? 0;
    if (executed > 0 && !manifest.repeatable) {
      continue;
    }

    if (!dependenciesSatisfied(manifest, options.context.artifacts)) {
      const missing = manifest.consumes.filter((key) => !options.context.artifacts.has(key));
      throw new Error(
        `Explicit route cannot execute '${manifest.name}': missing artifacts [${missing.join(", ")}].`,
      );
    }

    const canSkipSatisfied =
      options.skipSatisfied === true &&
      manifest.produces.length > 0 &&
      manifest.produces.every((key) => options.context.artifacts.has(key));
    if (canSkipSatisfied) {
      skippedSteps.push({
        skill: manifest.name,
        produces: [...manifest.produces],
        reason: "outputs_already_satisfied",
      });
      continue;
    }

    const output = await options.executeSkill(manifest, {
      ...options.context,
      trace,
    });
    trace.push(output);
    route.push(manifest.name);
    executedCounts.set(manifest.name, executed + 1);
  }

  return { trace, route, skippedSteps };
}
