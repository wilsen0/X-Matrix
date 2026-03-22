import type { SkillManifest } from "./types.js";

const STAGE_ORDER: SkillManifest["stage"][] = ["sensor", "planner", "guardrail", "executor", "memory"];
const CAPABILITY_TO_MODULES: Record<string, string[]> = {
  "okx-cex-market": ["market"],
  "okx-cex-portfolio": ["account"],
  "okx-cex-trade": ["spot", "swap", "option"],
};

export interface SkillRuntimeSurface {
  name: string;
  stage: SkillManifest["stage"];
  role: SkillManifest["role"];
  writes: boolean;
  riskLevel: SkillManifest["riskLevel"];
  requires: string[];
  consumes: SkillManifest["consumes"];
  produces: SkillManifest["produces"];
  preferredHandoffs: string[];
  triggers: string[];
  description: string;
  allowedExecutionModules: string[];
  standaloneCommand: string;
  standaloneRoute: string[];
  standaloneInputs: SkillManifest["standaloneInputs"];
  standaloneOutputs: SkillManifest["standaloneOutputs"];
  requiredCapabilities: SkillManifest["requiredCapabilities"];
  contractVersion: number;
  safetyClass: SkillManifest["safetyClass"];
  determinism: SkillManifest["determinism"];
}

export interface SkillGraphEdge {
  from: string;
  to: string;
  kind: "preferred_handoff" | "artifact_contract";
  label: string;
}

export interface SkillGraphView {
  nodes: SkillRuntimeSurface[];
  edges: SkillGraphEdge[];
  flagshipRoute: string[];
}

function stageRank(stage: SkillManifest["stage"]): number {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export function inferAllowedExecutionModules(manifest: SkillManifest): string[] {
  const modules = manifest.requires.flatMap((capability) => CAPABILITY_TO_MODULES[capability] ?? []);
  return unique(modules);
}

function toSurface(manifest: SkillManifest): SkillRuntimeSurface {
  return {
    name: manifest.name,
    stage: manifest.stage,
    role: manifest.role,
    writes: manifest.writes,
    riskLevel: manifest.riskLevel,
    requires: [...manifest.requires],
    consumes: [...manifest.consumes],
    produces: [...manifest.produces],
    preferredHandoffs: [...manifest.preferredHandoffs],
    triggers: [...manifest.triggers],
    description: manifest.description,
    allowedExecutionModules: inferAllowedExecutionModules(manifest),
    standaloneCommand: manifest.standaloneCommand,
    standaloneRoute: [...manifest.standaloneRoute],
    standaloneInputs: [...manifest.standaloneInputs],
    standaloneOutputs: [...manifest.standaloneOutputs],
    requiredCapabilities: [...manifest.requiredCapabilities],
    contractVersion: manifest.contractVersion,
    safetyClass: manifest.safetyClass,
    determinism: manifest.determinism,
  };
}

function compareManifests(left: SkillManifest, right: SkillManifest): number {
  return stageRank(left.stage) - stageRank(right.stage) || left.name.localeCompare(right.name);
}

function buildArtifactEdges(manifests: SkillManifest[]): SkillGraphEdge[] {
  const producersByArtifact = new Map<string, string[]>();
  for (const manifest of manifests) {
    for (const artifact of manifest.produces) {
      producersByArtifact.set(artifact, [...(producersByArtifact.get(artifact) ?? []), manifest.name]);
    }
  }

  const edges: SkillGraphEdge[] = [];
  for (const manifest of manifests) {
    for (const artifact of manifest.consumes) {
      for (const producer of producersByArtifact.get(artifact) ?? []) {
        if (producer === manifest.name) {
          continue;
        }
        edges.push({
          from: producer,
          to: manifest.name,
          kind: "artifact_contract",
          label: artifact,
        });
      }
    }
  }

  return edges;
}

function buildHandoffEdges(manifests: SkillManifest[]): SkillGraphEdge[] {
  return manifests.flatMap((manifest) =>
    manifest.preferredHandoffs.map((handoff) => ({
      from: manifest.name,
      to: handoff,
      kind: "preferred_handoff" as const,
      label: "preferred_handoff",
    })),
  );
}

function dedupeEdges(edges: SkillGraphEdge[]): SkillGraphEdge[] {
  const seen = new Set<string>();
  const deduped: SkillGraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.kind}|${edge.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(edge);
  }
  return deduped;
}

function buildFlagshipRoute(manifests: SkillManifest[]): string[] {
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const start =
    byName.get("portfolio-xray") ??
    manifests
      .filter((manifest) => manifest.stage === "sensor")
      .sort(compareManifests)[0];

  if (!start) {
    return [];
  }

  const route: string[] = [];
  const visited = new Set<string>();
  let current: SkillManifest | undefined = start;

  while (current && !visited.has(current.name)) {
    route.push(current.name);
    visited.add(current.name);
    const nextName: string | undefined = current.preferredHandoffs[0];
    current = nextName ? byName.get(nextName) : undefined;
  }

  return route;
}

export function buildSkillGraphView(manifests: SkillManifest[]): SkillGraphView {
  const sorted = [...manifests].sort(compareManifests);
  const edges = dedupeEdges([...buildHandoffEdges(sorted), ...buildArtifactEdges(sorted)]).sort((left, right) => {
    return left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.kind.localeCompare(right.kind);
  });

  return {
    nodes: sorted.map(toSurface),
    edges,
    flagshipRoute: buildFlagshipRoute(sorted),
  };
}

export function inspectSkillSurface(
  manifests: SkillManifest[],
  skillName: string,
): SkillRuntimeSurface | null {
  const manifest = manifests.find((entry) => entry.name === skillName);
  return manifest ? toSurface(manifest) : null;
}
