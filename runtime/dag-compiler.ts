import type { ArtifactKey, SkillManifest } from "./types.js";

export interface ExecutionPlan {
  levels: ExecutionLevel[];
  criticalPath: string[];
  totalDepth: number;
  maxParallelism: number;
  prunedSkills: PrunedSkill[];
  dependencyEdges: DependencyEdge[];
}

export interface ExecutionLevel {
  depth: number;
  skills: string[];
  isOnCriticalPath: boolean;
}

export interface PrunedSkill {
  name: string;
  reason: "unreachable_from_targets" | "no_consumers";
  produces: string[];
}

export interface DependencyEdge {
  from: string;
  to: string;
  artifact: string;
}

interface DependencyGraph {
  manifestsByName: Map<string, SkillManifest>;
  predecessors: Map<string, Set<string>>;
  successors: Map<string, Set<string>>;
  dependencyEdges: DependencyEdge[];
  producersByArtifact: Map<ArtifactKey, string[]>;
}

const COMPARE = (left: string, right: string): number => left.localeCompare(right);

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function sortedUnique(values: string[]): string[] {
  return uniqueStrings(values).sort(COMPARE);
}

function sortedSet(values: Set<string>): string[] {
  return [...values].sort(COMPARE);
}

function ensureUniqueManifestNames(manifests: SkillManifest[]): void {
  const names = new Set<string>();
  for (const manifest of manifests) {
    if (names.has(manifest.name)) {
      throw new Error(`Duplicate skill manifest name '${manifest.name}'.`);
    }
    names.add(manifest.name);
  }
}

function buildDependencyGraph(manifests: SkillManifest[]): DependencyGraph {
  const manifestsByName = new Map<string, SkillManifest>(manifests.map((manifest) => [manifest.name, manifest]));
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  const producersByArtifact = new Map<ArtifactKey, string[]>();

  for (const manifest of manifests) {
    predecessors.set(manifest.name, new Set<string>());
    successors.set(manifest.name, new Set<string>());
  }

  for (const manifest of manifests) {
    for (const artifact of uniqueStrings(manifest.produces)) {
      const existing = producersByArtifact.get(artifact as ArtifactKey) ?? [];
      producersByArtifact.set(artifact as ArtifactKey, sortedUnique([...existing, manifest.name]));
    }
  }

  const edgeKeys = new Set<string>();
  const dependencyEdges: DependencyEdge[] = [];

  const sortedManifests = [...manifests].sort((left, right) => COMPARE(left.name, right.name));
  for (const consumer of sortedManifests) {
    for (const artifact of sortedUnique(consumer.consumes)) {
      const producers = producersByArtifact.get(artifact as ArtifactKey) ?? [];
      for (const producerName of producers) {
        if (producerName === consumer.name) {
          continue;
        }

        const edgeKey = `${producerName}|${consumer.name}|${artifact}`;
        if (!edgeKeys.has(edgeKey)) {
          edgeKeys.add(edgeKey);
          dependencyEdges.push({
            from: producerName,
            to: consumer.name,
            artifact,
          });
        }

        predecessors.get(consumer.name)?.add(producerName);
        successors.get(producerName)?.add(consumer.name);
      }
    }
  }

  dependencyEdges.sort((left, right) => {
    return COMPARE(left.from, right.from) || COMPARE(left.to, right.to) || COMPARE(left.artifact, right.artifact);
  });

  return {
    manifestsByName,
    predecessors,
    successors,
    dependencyEdges,
    producersByArtifact,
  };
}

function resolveKeptSkills(
  manifests: SkillManifest[],
  graph: DependencyGraph,
  targetOutputs?: string[],
): { keptNames: Set<string>; prunedSkills: PrunedSkill[] } {
  if (!targetOutputs || targetOutputs.length === 0) {
    return {
      keptNames: new Set(manifests.map((manifest) => manifest.name)),
      prunedSkills: [],
    };
  }

  const targets = sortedUnique(targetOutputs);
  const targetSet = new Set(targets);
  const keptNames = new Set<string>();
  const visitedArtifacts = new Set<string>();
  const queue = [...targets];

  while (queue.length > 0) {
    const artifact = queue.shift()!;
    if (visitedArtifacts.has(artifact)) {
      continue;
    }
    visitedArtifacts.add(artifact);

    const producers = graph.producersByArtifact.get(artifact as ArtifactKey) ?? [];
    for (const producerName of producers) {
      if (keptNames.has(producerName)) {
        continue;
      }
      keptNames.add(producerName);
      const producer = graph.manifestsByName.get(producerName);
      if (!producer) {
        continue;
      }
      for (const consumed of sortedUnique(producer.consumes)) {
        if (!visitedArtifacts.has(consumed)) {
          queue.push(consumed);
        }
      }
    }
  }

  const prunedSkills: PrunedSkill[] = manifests
    .filter((manifest) => !keptNames.has(manifest.name))
    .map((manifest) => {
      const hasConsumers = (graph.successors.get(manifest.name)?.size ?? 0) > 0;
      const isTargetProducer = manifest.produces.some((artifact) => targetSet.has(artifact));
      const reason: PrunedSkill["reason"] = !hasConsumers && !isTargetProducer
        ? "no_consumers"
        : "unreachable_from_targets";
      return {
        name: manifest.name,
        reason,
        produces: sortedUnique(manifest.produces),
      };
    })
    .sort((left, right) => COMPARE(left.name, right.name));

  return {
    keptNames,
    prunedSkills,
  };
}

function findCyclePath(nodes: string[], successors: Map<string, Set<string>>): string[] {
  const nodeSet = new Set(nodes);
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const indexByNode = new Map<string, number>();

  function dfs(current: string): string[] | null {
    state.set(current, 1);
    indexByNode.set(current, stack.length);
    stack.push(current);

    const nextNodes = sortedSet(successors.get(current) ?? new Set<string>()).filter((next) => nodeSet.has(next));
    for (const next of nextNodes) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 0) {
        const found = dfs(next);
        if (found) {
          return found;
        }
        continue;
      }
      if (nextState === 1) {
        const startIndex = indexByNode.get(next) ?? 0;
        const cycle = stack.slice(startIndex);
        cycle.push(next);
        return cycle;
      }
    }

    stack.pop();
    indexByNode.delete(current);
    state.set(current, 2);
    return null;
  }

  for (const node of [...nodes].sort(COMPARE)) {
    if ((state.get(node) ?? 0) !== 0) {
      continue;
    }
    const cycle = dfs(node);
    if (cycle) {
      return cycle;
    }
  }

  if (nodes.length === 0) {
    return [];
  }
  return [nodes[0], nodes[0]];
}

function topoLevelsOrThrow(
  keptNames: Set<string>,
  predecessors: Map<string, Set<string>>,
  successors: Map<string, Set<string>>,
): { levels: ExecutionLevel[]; orderedSkills: string[] } {
  const indegree = new Map<string, number>();
  const pending = new Set<string>();
  for (const name of keptNames) {
    pending.add(name);
    const deps = predecessors.get(name) ?? new Set<string>();
    const internalDeps = [...deps].filter((dependency) => keptNames.has(dependency));
    indegree.set(name, internalDeps.length);
  }

  let ready = [...pending].filter((name) => (indegree.get(name) ?? 0) === 0).sort(COMPARE);
  const levels: ExecutionLevel[] = [];
  const orderedSkills: string[] = [];
  let depth = 0;

  while (ready.length > 0) {
    const levelSkills = [...ready].sort(COMPARE);
    levels.push({
      depth,
      skills: levelSkills,
      isOnCriticalPath: false,
    });
    depth += 1;

    const nextReady = new Set<string>();
    for (const name of levelSkills) {
      orderedSkills.push(name);
      pending.delete(name);
      const downstream = sortedSet(successors.get(name) ?? new Set<string>()).filter((next) => keptNames.has(next));
      for (const next of downstream) {
        const remaining = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, remaining);
        if (remaining === 0) {
          nextReady.add(next);
        }
      }
    }

    ready = [...nextReady].sort(COMPARE);
  }

  if (orderedSkills.length !== keptNames.size) {
    const remaining = [...pending].sort(COMPARE);
    const cycle = findCyclePath(remaining, successors);
    throw new Error(`Cycle detected in dependency graph: ${cycle.join(" -> ")}`);
  }

  return { levels, orderedSkills };
}

function criticalPathFromOrder(
  orderedSkills: string[],
  predecessors: Map<string, Set<string>>,
  keptNames: Set<string>,
): string[] {
  if (orderedSkills.length === 0) {
    return [];
  }

  const distance = new Map<string, number>();
  const previous = new Map<string, string | null>();

  for (const skill of orderedSkills) {
    const deps = sortedSet(predecessors.get(skill) ?? new Set<string>()).filter((name) => keptNames.has(name));
    if (deps.length === 0) {
      distance.set(skill, 1);
      previous.set(skill, null);
      continue;
    }

    let bestPrev = deps[0];
    let bestDistance = distance.get(bestPrev) ?? 1;

    for (const dependency of deps.slice(1)) {
      const candidateDistance = distance.get(dependency) ?? 1;
      if (candidateDistance > bestDistance) {
        bestDistance = candidateDistance;
        bestPrev = dependency;
        continue;
      }
      if (candidateDistance === bestDistance && COMPARE(dependency, bestPrev) < 0) {
        bestPrev = dependency;
      }
    }

    distance.set(skill, bestDistance + 1);
    previous.set(skill, bestPrev);
  }

  let end = orderedSkills[0];
  let maxDistance = distance.get(end) ?? 1;
  for (const skill of orderedSkills.slice(1)) {
    const skillDistance = distance.get(skill) ?? 1;
    if (skillDistance > maxDistance) {
      maxDistance = skillDistance;
      end = skill;
      continue;
    }
    if (skillDistance === maxDistance && COMPARE(skill, end) < 0) {
      end = skill;
    }
  }

  const path: string[] = [];
  let current: string | null = end;
  while (current) {
    path.push(current);
    current = previous.get(current) ?? null;
  }

  path.reverse();
  return path;
}

export function compileExecutionPlan(manifests: SkillManifest[], targetOutputs?: string[]): ExecutionPlan {
  if (manifests.length === 0) {
    return {
      levels: [],
      criticalPath: [],
      totalDepth: 0,
      maxParallelism: 0,
      prunedSkills: [],
      dependencyEdges: [],
    };
  }

  ensureUniqueManifestNames(manifests);

  const fullGraph = buildDependencyGraph(manifests);
  const { keptNames, prunedSkills } = resolveKeptSkills(manifests, fullGraph, targetOutputs);

  if (keptNames.size === 0) {
    return {
      levels: [],
      criticalPath: [],
      totalDepth: 0,
      maxParallelism: 0,
      prunedSkills,
      dependencyEdges: [],
    };
  }

  const activeManifests = manifests.filter((manifest) => keptNames.has(manifest.name));
  const activeGraph = buildDependencyGraph(activeManifests);
  const { levels, orderedSkills } = topoLevelsOrThrow(keptNames, activeGraph.predecessors, activeGraph.successors);
  const criticalPath = criticalPathFromOrder(orderedSkills, activeGraph.predecessors, keptNames);
  const criticalPathSet = new Set(criticalPath);

  const annotatedLevels = levels.map((level) => ({
    ...level,
    isOnCriticalPath: level.skills.some((skill) => criticalPathSet.has(skill)),
  }));

  const maxParallelism = annotatedLevels.reduce((max, level) => Math.max(max, level.skills.length), 0);

  return {
    levels: annotatedLevels,
    criticalPath,
    totalDepth: annotatedLevels.length,
    maxParallelism,
    prunedSkills,
    dependencyEdges: activeGraph.dependencyEdges,
  };
}
