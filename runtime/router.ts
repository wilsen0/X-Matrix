import type { SkillManifest } from "./types.js";

const SENSOR_ORDER = ["portfolio-xray", "market-scan"];
const EXECUTION_TAIL = ["official-executor", "replay"];
const CHAIN_TEMPLATES: Array<{ match: RegExp; chain: string[] }> = [
  {
    match: /(hedge|drawdown|protect|downside|risk|volatility|对冲|回撤|风险|波动)/i,
    chain: [
      "portfolio-xray",
      "market-scan",
      "hedge-planner",
      "policy-gate",
      "official-executor",
      "replay",
    ],
  },
  {
    match: /(grid|dca|bot|ladder)/i,
    chain: ["market-scan", "policy-gate", "official-executor", "replay"],
  },
];

function triggerScore(goal: string, manifest: SkillManifest): number {
  const loweredGoal = goal.toLowerCase();
  return manifest.triggers.reduce((score, trigger) => {
    return loweredGoal.includes(trigger.toLowerCase()) ? score + 1 : score;
  }, 0);
}

function isPlanningStage(manifest: SkillManifest): boolean {
  return (
    manifest.stage === "sensor" || manifest.stage === "planner" || manifest.stage === "guardrail"
  );
}

function uniqueSkillNames(skills: string[]): string[] {
  return skills.filter((name, index) => skills.indexOf(name) === index);
}

function uniqueManifests(manifests: SkillManifest[]): SkillManifest[] {
  const seen = new Set<string>();
  const unique: SkillManifest[] = [];

  for (const manifest of manifests) {
    if (seen.has(manifest.name)) {
      continue;
    }
    seen.add(manifest.name);
    unique.push(manifest);
  }

  return unique;
}

function buildTemplateChain(goal: string, manifests: SkillManifest[]): string[] {
  const selectedTemplate = CHAIN_TEMPLATES.find((template) => template.match.test(goal));
  if (!selectedTemplate) {
    return [];
  }

  const available = new Set(manifests.map((manifest) => manifest.name));
  return selectedTemplate.chain.filter((name) => available.has(name));
}

function triggeredSkills(goal: string, manifests: SkillManifest[]): string[] {
  const loweredGoal = goal.toLowerCase();
  return manifests
    .filter((manifest) => manifest.triggers.some((trigger) => loweredGoal.includes(trigger.toLowerCase())))
    .map((manifest) => manifest.name);
}

function buildDefaultPlanningRoute(goal: string, manifests: SkillManifest[]): SkillManifest[] {
  const sensors = manifests
    .filter((manifest) => manifest.stage === "sensor")
    .filter((manifest) => manifest.alwaysOn || triggerScore(goal, manifest) > 0)
    .sort((left, right) => {
      const leftIndex = SENSOR_ORDER.indexOf(left.name);
      const rightIndex = SENSOR_ORDER.indexOf(right.name);
      const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
      return normalizedLeft - normalizedRight || left.name.localeCompare(right.name);
    });

  const planner = manifests
    .filter((manifest) => manifest.stage === "planner")
    .sort((left, right) => triggerScore(goal, right) - triggerScore(goal, left))[0];

  const guardrails = manifests
    .filter((manifest) => manifest.stage === "guardrail")
    .sort((left, right) => left.name.localeCompare(right.name));

  return [...sensors, planner, ...guardrails].filter(
    (manifest): manifest is SkillManifest => Boolean(manifest),
  );
}

export function buildPlanningRoute(goal: string, manifests: SkillManifest[]): SkillManifest[] {
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const templatePlanningRoute = buildTemplateChain(goal, manifests)
    .map((name) => byName.get(name))
    .filter((manifest): manifest is SkillManifest => Boolean(manifest))
    .filter(isPlanningStage);
  const triggerPlanningRoute = triggeredSkills(goal, manifests)
    .map((name) => byName.get(name))
    .filter((manifest): manifest is SkillManifest => Boolean(manifest))
    .filter(isPlanningStage);

  if (templatePlanningRoute.length > 0) {
    return uniqueManifests([...templatePlanningRoute, ...triggerPlanningRoute]);
  }

  return buildDefaultPlanningRoute(goal, manifests);
}

export function buildRunRoute(goal: string, manifests: SkillManifest[]): string[] {
  const planningRoute = buildPlanningRoute(goal, manifests).map((manifest) => manifest.name);
  const installed = new Set(manifests.map((manifest) => manifest.name));
  const templateRoute = buildTemplateChain(goal, manifests);
  const triggerRoute = triggeredSkills(goal, manifests).filter((name) => installed.has(name));
  const route = uniqueSkillNames([
    ...(templateRoute.length > 0 ? templateRoute : planningRoute),
    ...triggerRoute,
  ]);

  for (const skillName of EXECUTION_TAIL) {
    if (installed.has(skillName) && !route.includes(skillName)) {
      route.push(skillName);
    }
  }

  return route;
}

export function resolveExecutor(manifests: SkillManifest[]): SkillManifest {
  const executor = manifests.find((manifest) => manifest.name === "official-executor");
  if (!executor) {
    throw new Error("No official-executor skill installed");
  }

  return executor;
}
