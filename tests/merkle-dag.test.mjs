import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerkleDag,
  getMerkleProofPath,
  stableJsonHash,
  verifyMerkleDag,
  verifySingleArtifact,
} from "../dist/runtime/merkle-dag.js";

function artifact(key, data) {
  return { key, data };
}

test("stableJsonHash is key-order invariant for objects", () => {
  const left = { b: 2, a: 1, nested: { y: 2, x: 1 } };
  const right = { a: 1, nested: { x: 1, y: 2 }, b: 2 };
  assert.equal(stableJsonHash(left), stableJsonHash(right));
});

test("single artifact DAG has one root/leaf and verifies cleanly", () => {
  const artifacts = new Map([["a", artifact("a", { value: 1 })]]);
  const producerMap = new Map([["a", "skill-a"]]);
  const consumerMap = new Map();

  const dag = buildMerkleDag(artifacts, producerMap, consumerMap);
  assert.deepEqual(dag.roots, ["a"]);
  assert.deepEqual(dag.leaves, ["a"]);
  assert.equal(dag.nodes.a.depth, 0);
  assert.deepEqual(dag.nodes.a.inputHashes, []);
  assert.equal(dag.chainDigest.length, 64);

  const verification = verifyMerkleDag(dag, artifacts);
  assert.equal(verification.valid, true);
  assert.equal(verification.invalidNodes.length, 0);
});

test("linear chain computes depth and chained parent hashes", () => {
  const artifacts = new Map([
    ["a", artifact("a", { value: "root" })],
    ["b", artifact("b", { value: "mid" })],
    ["c", artifact("c", { value: "leaf" })],
  ]);
  const producerMap = new Map([
    ["a", "sensor"],
    ["b", "planner"],
    ["c", "guardrail"],
  ]);
  const consumerMap = new Map([
    ["b", ["a"]],
    ["c", ["b"]],
  ]);

  const dag = buildMerkleDag(artifacts, producerMap, consumerMap);
  assert.deepEqual(dag.roots, ["a"]);
  assert.deepEqual(dag.leaves, ["c"]);
  assert.equal(dag.nodes.a.depth, 0);
  assert.equal(dag.nodes.b.depth, 1);
  assert.equal(dag.nodes.c.depth, 2);
  assert.deepEqual(dag.nodes.b.inputHashes, [dag.nodes.a.chainedHash]);
  assert.deepEqual(dag.nodes.c.inputHashes, [dag.nodes.b.chainedHash]);
});

test("diamond DAG merges two branches into one leaf", () => {
  const artifacts = new Map([
    ["a", artifact("a", { value: "root" })],
    ["b", artifact("b", { value: "left" })],
    ["c", artifact("c", { value: "right" })],
    ["d", artifact("d", { value: "merge" })],
  ]);
  const producerMap = new Map([
    ["a", "sensor"],
    ["b", "planner-left"],
    ["c", "planner-right"],
    ["d", "merge"],
  ]);
  const consumerMap = new Map([
    ["b", ["a"]],
    ["c", ["a"]],
    ["d", ["b", "c"]],
  ]);

  const dag = buildMerkleDag(artifacts, producerMap, consumerMap);
  assert.deepEqual(dag.roots, ["a"]);
  assert.deepEqual(dag.leaves, ["d"]);
  assert.equal(dag.nodes.d.depth, 2);
  assert.deepEqual(dag.nodes.d.inputHashes, [dag.nodes.b.chainedHash, dag.nodes.c.chainedHash].sort());
});

test("proof path verifies a single artifact without full DAG replay", () => {
  const artifacts = new Map([
    ["a", artifact("a", { value: "root" })],
    ["b", artifact("b", { value: "mid" })],
    ["c", artifact("c", { value: "leaf" })],
  ]);
  const producerMap = new Map([
    ["a", "sensor"],
    ["b", "planner"],
    ["c", "guardrail"],
  ]);
  const consumerMap = new Map([
    ["b", ["a"]],
    ["c", ["b"]],
  ]);

  const dag = buildMerkleDag(artifacts, producerMap, consumerMap);
  const proof = getMerkleProofPath(dag, "b");
  assert.equal(proof.target, "b");
  assert.deepEqual(proof.path.map((step) => step.artifactKey), ["b", "c"]);
  assert.equal(proof.expectedChainedHash, dag.nodes.c.chainedHash);
  assert.equal(verifySingleArtifact(proof, artifacts.get("b")), true);
});

test("tampering one artifact invalidates downstream chain verification", () => {
  const artifacts = new Map([
    ["a", artifact("a", { value: "root" })],
    ["b", artifact("b", { value: "mid" })],
    ["c", artifact("c", { value: "leaf" })],
  ]);
  const producerMap = new Map([
    ["a", "sensor"],
    ["b", "planner"],
    ["c", "guardrail"],
  ]);
  const consumerMap = new Map([
    ["b", ["a"]],
    ["c", ["b"]],
  ]);

  const dag = buildMerkleDag(artifacts, producerMap, consumerMap);
  const tamperedArtifacts = new Map(artifacts);
  tamperedArtifacts.set("b", artifact("b", { value: "tampered-mid" }));

  const verification = verifyMerkleDag(dag, tamperedArtifacts);
  assert.equal(verification.valid, false);
  assert.ok(verification.invalidNodes.includes("b"));
  assert.ok(verification.invalidNodes.includes("c"));
  assert.equal(verification.nodeResults.a.valid, true);
});

test("full DAG verification passes on untampered content", () => {
  const artifacts = new Map([
    ["a", artifact("a", { value: "root" })],
    ["b", artifact("b", { value: "left" })],
    ["c", artifact("c", { value: "right" })],
    ["d", artifact("d", { value: "merge" })],
  ]);
  const producerMap = new Map([
    ["a", "sensor"],
    ["b", "planner-left"],
    ["c", "planner-right"],
    ["d", "merge"],
  ]);
  const consumerMap = new Map([
    ["b", ["a"]],
    ["c", ["a"]],
    ["d", ["b", "c"]],
  ]);

  const dag = buildMerkleDag(artifacts, producerMap, consumerMap);
  const verification = verifyMerkleDag(dag, artifacts);
  assert.equal(verification.valid, true);
  assert.equal(verification.invalidNodes.length, 0);
  assert.equal(verification.chainDigest, dag.chainDigest);
});

test("empty DAG builds and verifies deterministically", () => {
  const artifacts = new Map();
  const producerMap = new Map();
  const consumerMap = new Map();

  const dag = buildMerkleDag(artifacts, producerMap, consumerMap);
  assert.deepEqual(dag.nodes, {});
  assert.deepEqual(dag.roots, []);
  assert.deepEqual(dag.leaves, []);
  assert.equal(dag.chainDigest.length, 64);

  const verification = verifyMerkleDag(dag, artifacts);
  assert.equal(verification.valid, true);
  assert.deepEqual(verification.nodeResults, {});
  assert.deepEqual(verification.invalidNodes, []);
  assert.equal(verification.chainDigest, dag.chainDigest);
});

test("complex multi-branch graph computes consistent roots/leaves/depths", () => {
  const artifacts = new Map([
    ["a", artifact("a", { branch: "root-a" })],
    ["b", artifact("b", { branch: "root-b" })],
    ["c", artifact("c", { branch: "from-a" })],
    ["d", artifact("d", { branch: "from-a-2" })],
    ["e", artifact("e", { branch: "merge-b-c" })],
    ["f", artifact("f", { branch: "merge-c-d" })],
    ["g", artifact("g", { branch: "final" })],
  ]);
  const producerMap = new Map([
    ["a", "sensor-a"],
    ["b", "sensor-b"],
    ["c", "planner-c"],
    ["d", "planner-d"],
    ["e", "guard-e"],
    ["f", "guard-f"],
    ["g", "executor-g"],
  ]);
  const consumerMap = new Map([
    ["c", ["a"]],
    ["d", ["a"]],
    ["e", ["b", "c"]],
    ["f", ["c", "d"]],
    ["g", ["e", "f"]],
  ]);

  const dag = buildMerkleDag(artifacts, producerMap, consumerMap);
  assert.deepEqual(dag.roots, ["a", "b"]);
  assert.deepEqual(dag.leaves, ["g"]);
  assert.equal(dag.nodes.c.depth, 1);
  assert.equal(dag.nodes.e.depth, 2);
  assert.equal(dag.nodes.g.depth, 3);

  const verification = verifyMerkleDag(dag, artifacts);
  assert.equal(verification.valid, true);
});

test("DAG builder infers dependencies from artifact->consumer skills map", () => {
  const artifacts = new Map([
    ["a", artifact("a", { value: "root" })],
    ["b", artifact("b", { value: "middle" })],
    ["c", artifact("c", { value: "leaf" })],
  ]);
  const producerMap = new Map([
    ["a", "sensor"],
    ["b", "planner"],
    ["c", "guardrail"],
  ]);
  const consumerMap = new Map([
    ["a", ["planner"]],
    ["b", ["guardrail"]],
  ]);

  const dag = buildMerkleDag(artifacts, producerMap, consumerMap);
  assert.deepEqual(dag.roots, ["a"]);
  assert.deepEqual(dag.leaves, ["c"]);
  assert.equal(dag.nodes.b.depth, 1);
  assert.equal(dag.nodes.c.depth, 2);
});
