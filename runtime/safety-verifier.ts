import type { ArtifactKey, SkillManifest } from "./types.js";

export interface SafetyInvariant {
  name: string;
  description: string;
  passed: boolean;
  violations: SafetyViolation[];
}

export interface SafetyViolation {
  invariant: string;
  severity: "error" | "warning";
  skill: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SafetyVerdict {
  passed: boolean;
  invariants: SafetyInvariant[];
  totalViolations: number;
  errorCount: number;
  warningCount: number;
  verifiedAt: string;
  skillCount: number;
  edgeCount: number;
}

interface DependencyGraph {
  nodes: string[];
  forward: Map<string, Set<string>>;
  reverse: Map<string, Set<string>>;
  edges: Array<{ from: string; to: string; artifacts: ArtifactKey[] }>;
  byName: Map<string, SkillManifest>;
}

const INVARIANT_NAMES = {
  writePathGuardrail: "write-path-guardrail",
  approvalPath: "approval-path",
  cycleFreedom: "cycle-freedom",
  capabilitySatisfiability: "capability-satisfiability",
  singleWriter: "single-writer",
  completeness: "completeness",
} as const;

function toSet(values: string[] | undefined): Set<string> {
  return new Set(Array.isArray(values) ? values : []);
}

function stringList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((entry): entry is string => typeof entry === "string");
}

function artifactSet(values: unknown): Set<ArtifactKey> {
  return new Set(stringList(values) as ArtifactKey[]);
}

function createInvariant(name: string, description: string, violations: SafetyViolation[]): SafetyInvariant {
  return {
    name,
    description,
    passed: violations.length === 0,
    violations,
  };
}

function buildDependencyGraph(manifests: SkillManifest[]): DependencyGraph {
  const byName = new Map<string, SkillManifest>();
  const nodes: string[] = [];
  for (const manifest of manifests) {
    byName.set(manifest.name, manifest);
    nodes.push(manifest.name);
  }

  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const node of nodes) {
    forward.set(node, new Set());
    reverse.set(node, new Set());
  }

  const producersByArtifact = new Map<ArtifactKey, Set<string>>();
  for (const manifest of manifests) {
    const produced = artifactSet(manifest.produces);
    for (const artifact of produced) {
      const producers = producersByArtifact.get(artifact) ?? new Set<string>();
      producers.add(manifest.name);
      producersByArtifact.set(artifact, producers);
    }
  }

  const edgeArtifacts = new Map<string, Set<ArtifactKey>>();
  for (const manifest of manifests) {
    const consumed = artifactSet(manifest.consumes);
    for (const consumedArtifact of consumed) {
      const producers = producersByArtifact.get(consumedArtifact);
      if (!producers) {
        continue;
      }
      for (const producer of producers) {
        const edgeKey = `${producer} -> ${manifest.name}`;
        const current = edgeArtifacts.get(edgeKey) ?? new Set<ArtifactKey>();
        current.add(consumedArtifact);
        edgeArtifacts.set(edgeKey, current);
      }
    }
  }

  const edges: Array<{ from: string; to: string; artifacts: ArtifactKey[] }> = [];
  for (const [edgeKey, artifactSet] of edgeArtifacts.entries()) {
    const separator = edgeKey.indexOf(" -> ");
    const from = edgeKey.slice(0, separator);
    const to = edgeKey.slice(separator + 4);
    if (!forward.has(from)) {
      forward.set(from, new Set());
    }
    if (!reverse.has(to)) {
      reverse.set(to, new Set());
    }
    forward.get(from)?.add(to);
    reverse.get(to)?.add(from);
    edges.push({
      from,
      to,
      artifacts: [...artifactSet].sort((left, right) => left.localeCompare(right)),
    });
  }

  edges.sort((left, right) => {
    const fromDiff = left.from.localeCompare(right.from);
    if (fromDiff !== 0) {
      return fromDiff;
    }
    return left.to.localeCompare(right.to);
  });

  return { nodes, forward, reverse, edges, byName };
}

function hasAncestor(
  graph: DependencyGraph,
  skillName: string,
  predicate: (manifest: SkillManifest) => boolean,
): boolean {
  const queue = [...(graph.reverse.get(skillName) ?? new Set<string>())];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const manifest = graph.byName.get(current);
    if (manifest && predicate(manifest)) {
      return true;
    }
    for (const parent of graph.reverse.get(current) ?? new Set<string>()) {
      if (!visited.has(parent)) {
        queue.push(parent);
      }
    }
  }

  return false;
}

function firstCyclePath(graph: DependencyGraph): string[] | null {
  type Color = 0 | 1 | 2;
  const color = new Map<string, Color>();
  for (const node of graph.nodes) {
    color.set(node, 0);
  }

  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    color.set(node, 1);
    stack.push(node);

    for (const next of graph.forward.get(node) ?? new Set<string>()) {
      const nextColor = color.get(next) ?? 0;
      if (nextColor === 0) {
        const cycle = dfs(next);
        if (cycle) {
          return cycle;
        }
      } else if (nextColor === 1) {
        const start = stack.lastIndexOf(next);
        if (start >= 0) {
          return [...stack.slice(start), next];
        }
        return [next, next];
      }
    }

    stack.pop();
    color.set(node, 2);
    return null;
  };

  for (const node of graph.nodes) {
    if ((color.get(node) ?? 0) !== 0) {
      continue;
    }
    const cycle = dfs(node);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

export function checkWritePathGuardrail(manifests: SkillManifest[]): SafetyInvariant {
  const graph = buildDependencyGraph(manifests);
  const violations: SafetyViolation[] = [];

  for (const manifest of manifests) {
    if (!manifest.writes) {
      continue;
    }
    const guardrailPresent = hasAncestor(
      graph,
      manifest.name,
      (ancestor) => ancestor.stage === "guardrail",
    );
    if (!guardrailPresent) {
      violations.push({
        invariant: INVARIANT_NAMES.writePathGuardrail,
        severity: "error",
        skill: manifest.name,
        message: `Write skill '${manifest.name}' has no guardrail ancestor in its dependency path.`,
        details: {
          stage: manifest.stage,
          writes: manifest.writes,
        },
      });
    }
  }

  return createInvariant(
    INVARIANT_NAMES.writePathGuardrail,
    "Every skill with writes=true must have an ancestor in stage='guardrail'.",
    violations,
  );
}

export function checkApprovalPath(manifests: SkillManifest[]): SafetyInvariant {
  const graph = buildDependencyGraph(manifests);
  const violations: SafetyViolation[] = [];

  for (const manifest of manifests) {
    if (!manifest.writes) {
      continue;
    }
    const approvalAncestor = hasAncestor(
      graph,
      manifest.name,
      (ancestor) => ancestor.name.toLowerCase().includes("approval"),
    );
    if (!approvalAncestor) {
      violations.push({
        invariant: INVARIANT_NAMES.approvalPath,
        severity: "error",
        skill: manifest.name,
        message: `Write skill '${manifest.name}' has no approval ancestor in its dependency path.`,
      });
    }
  }

  return createInvariant(
    INVARIANT_NAMES.approvalPath,
    "Every skill with writes=true must have an ancestor whose name includes 'approval'.",
    violations,
  );
}

export function checkCycleFreedom(manifests: SkillManifest[]): SafetyInvariant {
  const graph = buildDependencyGraph(manifests);
  const cyclePath = firstCyclePath(graph);
  const violations: SafetyViolation[] = [];

  if (cyclePath && cyclePath.length > 0) {
    violations.push({
      invariant: INVARIANT_NAMES.cycleFreedom,
      severity: "error",
      skill: cyclePath[0],
      message: `Dependency cycle detected: ${cyclePath.join(" -> ")}`,
      details: {
        cyclePath,
      },
    });
  }

  return createInvariant(
    INVARIANT_NAMES.cycleFreedom,
    "Dependency graph must be acyclic.",
    violations,
  );
}

export function checkCapabilitySatisfiability(
  manifests: SkillManifest[],
  available: string[],
): SafetyInvariant {
  const availableSet = toSet(available);
  const violations: SafetyViolation[] = [];

  for (const manifest of manifests) {
    const required = Array.isArray(manifest.requiredCapabilities)
      ? manifest.requiredCapabilities.map((entry) => String(entry))
      : [];
    const missing = required.filter((capability) => !availableSet.has(capability));
    if (missing.length > 0) {
      violations.push({
        invariant: INVARIANT_NAMES.capabilitySatisfiability,
        severity: "error",
        skill: manifest.name,
        message: `Skill '${manifest.name}' requires unavailable capabilities: ${missing.join(", ")}`,
        details: {
          missingCapabilities: missing,
          requiredCapabilities: required,
        },
      });
    }
  }

  return createInvariant(
    INVARIANT_NAMES.capabilitySatisfiability,
    "All required capabilities must be satisfiable by the available capability set.",
    violations,
  );
}

export function checkSingleWriter(manifests: SkillManifest[]): SafetyInvariant {
  const producersByArtifact = new Map<ArtifactKey, Set<string>>();
  const violations: SafetyViolation[] = [];

  for (const manifest of manifests) {
    const produced = artifactSet(manifest.produces);
    for (const artifact of produced) {
      const producers = producersByArtifact.get(artifact) ?? new Set<string>();
      producers.add(manifest.name);
      producersByArtifact.set(artifact, producers);
    }
  }

  for (const [artifact, producerSet] of producersByArtifact.entries()) {
    if (producerSet.size <= 1) {
      continue;
    }
    const producers = [...producerSet].sort((left, right) => left.localeCompare(right));
    violations.push({
      invariant: INVARIANT_NAMES.singleWriter,
      severity: "error",
      skill: producers[0],
      message: `Artifact '${artifact}' has multiple producers: ${producers.join(", ")}`,
      details: {
        artifact,
        producers,
      },
    });
  }

  return createInvariant(
    INVARIANT_NAMES.singleWriter,
    "Each artifact must be produced by at most one skill.",
    violations,
  );
}

export function checkCompleteness(
  manifests: SkillManifest[],
  initialArtifacts: string[] = [],
): SafetyInvariant {
  const produced = new Set<ArtifactKey>();
  const initial = toSet(initialArtifacts);
  const violations: SafetyViolation[] = [];

  for (const manifest of manifests) {
    for (const artifact of artifactSet(manifest.produces)) {
      produced.add(artifact);
    }
  }

  for (const manifest of manifests) {
    for (const consumedArtifact of artifactSet(manifest.consumes)) {
      if (produced.has(consumedArtifact) || initial.has(consumedArtifact)) {
        continue;
      }
      violations.push({
        invariant: INVARIANT_NAMES.completeness,
        severity: "error",
        skill: manifest.name,
        message: `Skill '${manifest.name}' consumes '${consumedArtifact}' but no producer or initial artifact provides it.`,
        details: {
          consumedArtifact,
        },
      });
    }
  }

  return createInvariant(
    INVARIANT_NAMES.completeness,
    "Every consumed artifact must be produced by some skill or supplied as an initial artifact.",
    violations,
  );
}

export function verifySafetyInvariants(
  manifests: SkillManifest[],
  options?: { availableCapabilities?: string[]; initialArtifacts?: string[] },
): SafetyVerdict {
  const graph = buildDependencyGraph(manifests);
  const availableCapabilities = options?.availableCapabilities ?? [];
  const initialArtifacts = options?.initialArtifacts ?? [];
  const invariants = [
    checkWritePathGuardrail(manifests),
    checkApprovalPath(manifests),
    checkCycleFreedom(manifests),
    checkCapabilitySatisfiability(manifests, availableCapabilities),
    checkSingleWriter(manifests),
    checkCompleteness(manifests, initialArtifacts),
  ];

  let totalViolations = 0;
  let errorCount = 0;
  let warningCount = 0;
  for (const invariant of invariants) {
    totalViolations += invariant.violations.length;
    for (const violation of invariant.violations) {
      if (violation.severity === "error") {
        errorCount += 1;
      } else {
        warningCount += 1;
      }
    }
  }

  return {
    passed: errorCount === 0 && invariants.every((invariant) => invariant.passed),
    invariants,
    totalViolations,
    errorCount,
    warningCount,
    verifiedAt: new Date().toISOString(),
    skillCount: manifests.length,
    edgeCount: graph.edges.length,
  };
}
