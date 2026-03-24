import { createHash } from "node:crypto";

export interface MerkleNode {
  artifactKey: string;
  contentHash: string;
  inputHashes: string[];
  chainedHash: string;
  producedBy: string;
  depth: number;
}

export interface MerkleDag {
  nodes: Record<string, MerkleNode>;
  roots: string[];
  leaves: string[];
  chainDigest: string;
}

export interface MerkleProofPath {
  target: string;
  path: MerkleProofStep[];
  expectedChainedHash: string;
}

export interface MerkleProofStep {
  artifactKey: string;
  contentHash: string;
  inputHashes: string[];
  chainedHash: string;
}

export interface MerkleVerification {
  valid: boolean;
  chainDigest: string;
  nodeResults: Record<string, { valid: boolean; expected: string; actual: string }>;
  invalidNodes: string[];
}

interface ArtifactContent {
  key: string;
  data: unknown;
}

interface ExpectedNodeState {
  contentHash: string;
  chainedHash: string;
  depth: number;
  missingArtifact: boolean;
}

interface DagRelationships {
  parentKeysByNode: Map<string, string[]>;
  childrenByNode: Map<string, Set<string>>;
  structuralInvalid: Set<string>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForStableJson(entry));
  }

  if (value && typeof value === "object") {
    if (value instanceof Date) {
      return value.toJSON();
    }

    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
      const normalizedValue = normalizeForStableJson(record[key]);
      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue;
      }
    }
    return normalized;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
    return undefined;
  }

  return value;
}

function stableJson(value: unknown): string {
  const normalized = normalizeForStableJson(value);
  const encoded = JSON.stringify(normalized);
  return encoded ?? "null";
}

function hashArtifactContent(artifact: ArtifactContent): string {
  return stableJsonHash({ key: artifact.key, data: artifact.data });
}

function computeChainedHash(contentHash: string, inputHashes: string[]): string {
  return sha256(`${contentHash}${sortStrings(inputHashes).join("")}`);
}

function buildHashIndex(nodes: Record<string, MerkleNode>): Map<string, string[]> {
  const hashIndex = new Map<string, string[]>();
  for (const [artifactKey, node] of Object.entries(nodes)) {
    const existing = hashIndex.get(node.chainedHash) ?? [];
    hashIndex.set(node.chainedHash, [...existing, artifactKey]);
  }

  for (const [hash, keys] of hashIndex.entries()) {
    hashIndex.set(hash, sortStrings(keys));
  }

  return hashIndex;
}

function deriveDagRelationships(dag: MerkleDag): DagRelationships {
  const parentKeysByNode = new Map<string, string[]>();
  const childrenByNode = new Map<string, Set<string>>();
  const structuralInvalid = new Set<string>();
  const hashIndex = buildHashIndex(dag.nodes);
  const artifactKeys = sortStrings(Object.keys(dag.nodes));

  for (const artifactKey of artifactKeys) {
    childrenByNode.set(artifactKey, new Set<string>());
  }

  for (const artifactKey of artifactKeys) {
    const node = dag.nodes[artifactKey];
    const parents = new Set<string>();

    for (const inputHash of node.inputHashes) {
      const matchedParents = hashIndex.get(inputHash) ?? [];
      if (matchedParents.length === 0) {
        structuralInvalid.add(artifactKey);
        continue;
      }

      if (matchedParents.length > 1) {
        structuralInvalid.add(artifactKey);
      }

      for (const parentKey of matchedParents) {
        if (parentKey === artifactKey) {
          structuralInvalid.add(artifactKey);
          continue;
        }

        parents.add(parentKey);
        childrenByNode.get(parentKey)?.add(artifactKey);
      }
    }

    parentKeysByNode.set(artifactKey, sortStrings([...parents]));
  }

  return {
    parentKeysByNode,
    childrenByNode,
    structuralInvalid,
  };
}

function resolveInputArtifacts(
  artifactKey: string,
  artifacts: Map<string, ArtifactContent>,
  producerMap: Map<string, string>,
  consumerMap: Map<string, string[]>,
): string[] {
  const inputs = new Set<string>();

  // Direct form: artifact -> consumed artifact keys.
  for (const dependencyKey of consumerMap.get(artifactKey) ?? []) {
    if (dependencyKey !== artifactKey && artifacts.has(dependencyKey)) {
      inputs.add(dependencyKey);
    }
  }

  // Inferred form: artifact -> consumer skill names.
  const producer = producerMap.get(artifactKey);
  if (producer) {
    for (const [sourceArtifactKey, consumers] of consumerMap.entries()) {
      if (sourceArtifactKey === artifactKey || !artifacts.has(sourceArtifactKey)) {
        continue;
      }
      if (consumers.includes(producer)) {
        inputs.add(sourceArtifactKey);
      }
    }
  }

  return sortStrings([...inputs]);
}

export function stableJsonHash(value: unknown): string {
  return sha256(stableJson(value));
}

export function buildMerkleDag(
  artifacts: Map<string, { key: string; data: unknown }>,
  producerMap: Map<string, string>,
  consumerMap: Map<string, string[]>,
): MerkleDag {
  const artifactKeys = sortStrings([...artifacts.keys()]);
  const dependencyKeysByArtifact = new Map<string, string[]>();
  const childrenByArtifact = new Map<string, Set<string>>();

  for (const artifactKey of artifactKeys) {
    const dependencies = resolveInputArtifacts(artifactKey, artifacts, producerMap, consumerMap);
    dependencyKeysByArtifact.set(artifactKey, dependencies);

    for (const dependencyKey of dependencies) {
      if (!childrenByArtifact.has(dependencyKey)) {
        childrenByArtifact.set(dependencyKey, new Set<string>());
      }
      childrenByArtifact.get(dependencyKey)?.add(artifactKey);
    }
  }

  const nodesByKey = new Map<string, MerkleNode>();
  const visiting = new Set<string>();

  const computeNode = (artifactKey: string): MerkleNode => {
    const cached = nodesByKey.get(artifactKey);
    if (cached) {
      return cached;
    }

    if (visiting.has(artifactKey)) {
      throw new Error(`Cycle detected in artifact dependencies at '${artifactKey}'.`);
    }

    visiting.add(artifactKey);
    const artifact = artifacts.get(artifactKey);
    if (!artifact) {
      visiting.delete(artifactKey);
      throw new Error(`Artifact '${artifactKey}' is missing from the artifact map.`);
    }

    const inputNodes = (dependencyKeysByArtifact.get(artifactKey) ?? []).map((dependencyKey) => computeNode(dependencyKey));
    const inputHashes = sortStrings(inputNodes.map((inputNode) => inputNode.chainedHash));
    const depth = inputNodes.length === 0 ? 0 : Math.max(...inputNodes.map((inputNode) => inputNode.depth)) + 1;
    const contentHash = hashArtifactContent(artifact);
    const node: MerkleNode = {
      artifactKey,
      contentHash,
      inputHashes,
      chainedHash: computeChainedHash(contentHash, inputHashes),
      producedBy: producerMap.get(artifactKey) ?? "unknown",
      depth,
    };

    nodesByKey.set(artifactKey, node);
    visiting.delete(artifactKey);
    return node;
  };

  for (const artifactKey of artifactKeys) {
    computeNode(artifactKey);
  }

  const nodes: Record<string, MerkleNode> = Object.fromEntries(
    artifactKeys.map((artifactKey) => [artifactKey, nodesByKey.get(artifactKey) as MerkleNode]),
  );
  const roots = artifactKeys.filter((artifactKey) => (dependencyKeysByArtifact.get(artifactKey) ?? []).length === 0);
  const leaves = artifactKeys.filter((artifactKey) => (childrenByArtifact.get(artifactKey)?.size ?? 0) === 0);
  const leafHashes = sortStrings(leaves.map((artifactKey) => nodes[artifactKey].chainedHash));
  const chainDigest = sha256(leafHashes.join(""));

  return {
    nodes,
    roots,
    leaves,
    chainDigest,
  };
}

export function getMerkleProofPath(dag: MerkleDag, artifactKey: string): MerkleProofPath {
  if (!dag.nodes[artifactKey]) {
    throw new Error(`Unknown artifact '${artifactKey}' in Merkle DAG.`);
  }

  const { childrenByNode } = deriveDagRelationships(dag);
  const pathKeys: string[] = [];
  const seen = new Set<string>();
  let current = artifactKey;

  while (!seen.has(current)) {
    pathKeys.push(current);
    seen.add(current);

    const children = [...(childrenByNode.get(current) ?? new Set<string>())]
      .filter((candidate) => !seen.has(candidate))
      .sort((left, right) => {
        const depthDiff = dag.nodes[right].depth - dag.nodes[left].depth;
        if (depthDiff !== 0) {
          return depthDiff;
        }
        return left.localeCompare(right);
      });

    const next = children[0];
    if (!next) {
      break;
    }
    current = next;
  }

  const path: MerkleProofStep[] = pathKeys.map((pathKey) => {
    const node = dag.nodes[pathKey];
    return {
      artifactKey: node.artifactKey,
      contentHash: node.contentHash,
      inputHashes: [...node.inputHashes],
      chainedHash: node.chainedHash,
    };
  });

  return {
    target: artifactKey,
    path,
    expectedChainedHash: path[path.length - 1].chainedHash,
  };
}

export function verifyMerkleDag(
  dag: MerkleDag,
  artifacts: Map<string, { key: string; data: unknown }>,
): MerkleVerification {
  const artifactKeys = sortStrings(Object.keys(dag.nodes));
  const { parentKeysByNode, childrenByNode, structuralInvalid } = deriveDagRelationships(dag);
  const expectedByNode = new Map<string, ExpectedNodeState>();
  const visiting = new Set<string>();

  const computeExpected = (artifactKey: string): ExpectedNodeState => {
    const cached = expectedByNode.get(artifactKey);
    if (cached) {
      return cached;
    }

    if (visiting.has(artifactKey)) {
      structuralInvalid.add(artifactKey);
      return {
        contentHash: "",
        chainedHash: "",
        depth: 0,
        missingArtifact: true,
      };
    }

    visiting.add(artifactKey);
    const parentStates = (parentKeysByNode.get(artifactKey) ?? []).map((parentKey) => computeExpected(parentKey));
    const artifact = artifacts.get(artifactKey);
    const missingArtifact = !artifact;
    const contentHash = missingArtifact ? "" : hashArtifactContent(artifact);
    const inputHashes = sortStrings(parentStates.map((parentState) => parentState.chainedHash));
    const chainedHash = computeChainedHash(contentHash, inputHashes);
    const depth = parentStates.length === 0 ? 0 : Math.max(...parentStates.map((parentState) => parentState.depth)) + 1;

    const expectedNode: ExpectedNodeState = {
      contentHash,
      chainedHash,
      depth,
      missingArtifact,
    };

    expectedByNode.set(artifactKey, expectedNode);
    visiting.delete(artifactKey);
    return expectedNode;
  };

  for (const artifactKey of artifactKeys) {
    computeExpected(artifactKey);
  }

  const nodeResults: Record<string, { valid: boolean; expected: string; actual: string }> = {};
  const invalidNodes: string[] = [];

  for (const artifactKey of artifactKeys) {
    const node = dag.nodes[artifactKey];
    const expected = expectedByNode.get(artifactKey) as ExpectedNodeState;
    const expectedInputHashes = sortStrings(
      (parentKeysByNode.get(artifactKey) ?? []).map((parentKey) => (expectedByNode.get(parentKey) as ExpectedNodeState).chainedHash),
    );
    const actualInputHashes = sortStrings(node.inputHashes);
    const valid =
      !expected.missingArtifact &&
      !structuralInvalid.has(artifactKey) &&
      node.contentHash === expected.contentHash &&
      node.chainedHash === expected.chainedHash &&
      node.depth === expected.depth &&
      arraysEqual(actualInputHashes, expectedInputHashes);

    nodeResults[artifactKey] = {
      valid,
      expected: expected.chainedHash,
      actual: node.chainedHash,
    };

    if (!valid) {
      invalidNodes.push(artifactKey);
    }
  }

  const computedRoots = artifactKeys.filter((artifactKey) => (parentKeysByNode.get(artifactKey) ?? []).length === 0);
  const computedLeaves = artifactKeys.filter((artifactKey) => (childrenByNode.get(artifactKey)?.size ?? 0) === 0);
  const expectedChainDigest = sha256(
    sortStrings(computedLeaves.map((artifactKey) => (expectedByNode.get(artifactKey) as ExpectedNodeState).chainedHash)).join(""),
  );
  const rootsMatch = arraysEqual(sortStrings(dag.roots), computedRoots);
  const leavesMatch = arraysEqual(sortStrings(dag.leaves), computedLeaves);
  const chainDigestMatch = dag.chainDigest === expectedChainDigest;

  return {
    valid: invalidNodes.length === 0 && rootsMatch && leavesMatch && chainDigestMatch,
    chainDigest: expectedChainDigest,
    nodeResults,
    invalidNodes: sortStrings(invalidNodes),
  };
}

export function verifySingleArtifact(
  proofPath: MerkleProofPath,
  artifactContent: { key: string; data: unknown },
): boolean {
  if (proofPath.target !== artifactContent.key || proofPath.path.length === 0) {
    return false;
  }

  const [targetStep, ...downstreamSteps] = proofPath.path;
  if (targetStep.artifactKey !== proofPath.target) {
    return false;
  }

  const contentHash = hashArtifactContent(artifactContent);
  if (contentHash !== targetStep.contentHash) {
    return false;
  }

  const targetChainedHash = computeChainedHash(contentHash, targetStep.inputHashes);
  if (targetChainedHash !== targetStep.chainedHash) {
    return false;
  }

  let previousHash = targetStep.chainedHash;
  for (const step of downstreamSteps) {
    const recomputed = computeChainedHash(step.contentHash, step.inputHashes);
    if (recomputed !== step.chainedHash) {
      return false;
    }
    if (!step.inputHashes.includes(previousHash)) {
      return false;
    }
    previousHash = step.chainedHash;
  }

  return previousHash === proofPath.expectedChainedHash;
}
