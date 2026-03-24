import assert from "node:assert/strict";
import test from "node:test";
import { compileExecutionPlan } from "../dist/runtime/dag-compiler.js";

function roleForStage(stage) {
  if (stage === "sensor") {
    return "sensor";
  }
  if (stage === "planner") {
    return "planner";
  }
  if (stage === "guardrail") {
    return "guardrail";
  }
  if (stage === "executor") {
    return "executor";
  }
  return "memory";
}

function makeManifest(name, { stage = "planner", consumes = [], produces = [] } = {}) {
  return {
    name,
    description: `${name} test manifest`,
    stage,
    role: roleForStage(stage),
    requires: [],
    riskLevel: "low",
    writes: false,
    alwaysOn: false,
    triggers: [],
    path: `skills/${name}`,
    consumes,
    produces,
    preferredHandoffs: [],
    repeatable: false,
    artifactVersion: 1,
    standaloneCommand: `trademesh skills run ${name} "<goal>"`,
    standaloneRoute: [name],
    standaloneInputs: ["goal"],
    standaloneOutputs: produces,
    requiredCapabilities: [],
    contractVersion: 1,
    safetyClass: "read",
    determinism: "high",
    proofClass: "structural",
    proofTargetOutputs: [],
  };
}

test("compileExecutionPlan builds linear chain levels and critical path", () => {
  const manifests = [
    makeManifest("skill-a", { produces: ["x"] }),
    makeManifest("skill-b", { consumes: ["x"], produces: ["y"] }),
    makeManifest("skill-c", { consumes: ["y"], produces: ["z"] }),
  ];

  const plan = compileExecutionPlan(manifests, ["z"]);

  assert.deepEqual(plan.levels.map((level) => level.skills), [["skill-a"], ["skill-b"], ["skill-c"]]);
  assert.deepEqual(plan.criticalPath, ["skill-a", "skill-b", "skill-c"]);
  assert.equal(plan.totalDepth, 3);
  assert.equal(plan.maxParallelism, 1);
  assert.deepEqual(plan.prunedSkills, []);
  assert.deepEqual(plan.dependencyEdges, [
    { from: "skill-a", to: "skill-b", artifact: "x" },
    { from: "skill-b", to: "skill-c", artifact: "y" },
  ]);
});

test("compileExecutionPlan groups parallel branches in same level", () => {
  const manifests = [
    makeManifest("branch-a", { produces: ["x"] }),
    makeManifest("branch-b", { produces: ["y"] }),
    makeManifest("join", { consumes: ["x", "y"], produces: ["z"] }),
  ];

  const plan = compileExecutionPlan(manifests, ["z"]);

  assert.deepEqual(plan.levels.map((level) => level.skills), [["branch-a", "branch-b"], ["join"]]);
  assert.equal(plan.maxParallelism, 2);
  assert.equal(plan.totalDepth, 2);
  assert.deepEqual(plan.criticalPath, ["branch-a", "join"]);
  assert.deepEqual(plan.dependencyEdges, [
    { from: "branch-a", to: "join", artifact: "x" },
    { from: "branch-b", to: "join", artifact: "y" },
  ]);
});

test("compileExecutionPlan handles diamond dependency graphs", () => {
  const manifests = [
    makeManifest("root", { produces: ["x"] }),
    makeManifest("left", { consumes: ["x"], produces: ["y"] }),
    makeManifest("right", { consumes: ["x"], produces: ["z"] }),
    makeManifest("tail", { consumes: ["y", "z"], produces: ["out"] }),
  ];

  const plan = compileExecutionPlan(manifests, ["out"]);

  assert.deepEqual(plan.levels.map((level) => level.skills), [["root"], ["left", "right"], ["tail"]]);
  assert.deepEqual(plan.criticalPath, ["root", "left", "tail"]);
  assert.equal(plan.levels[1].isOnCriticalPath, true);
  assert.equal(plan.totalDepth, 3);
  assert.equal(plan.maxParallelism, 2);
});

test("compileExecutionPlan prunes dead skills by backward target reachability", () => {
  const manifests = [
    makeManifest("main-a", { produces: ["m1"] }),
    makeManifest("main-b", { consumes: ["m1"], produces: ["m2"] }),
    makeManifest("main-c", { consumes: ["m2"], produces: ["target"] }),
    makeManifest("side-a", { produces: ["s1"] }),
    makeManifest("side-b", { consumes: ["s1"], produces: ["s2"] }),
    makeManifest("bridge-a", { produces: ["b1"] }),
    makeManifest("bridge-b", { consumes: ["b1"], produces: ["b2"] }),
    makeManifest("orphan", { produces: ["o1"] }),
  ];

  const plan = compileExecutionPlan(manifests, ["target"]);

  assert.deepEqual(plan.levels.map((level) => level.skills), [["main-a"], ["main-b"], ["main-c"]]);
  assert.deepEqual(plan.criticalPath, ["main-a", "main-b", "main-c"]);
  assert.deepEqual(plan.dependencyEdges, [
    { from: "main-a", to: "main-b", artifact: "m1" },
    { from: "main-b", to: "main-c", artifact: "m2" },
  ]);

  const reasonBySkill = new Map(plan.prunedSkills.map((entry) => [entry.name, entry.reason]));
  assert.equal(reasonBySkill.get("side-a"), "unreachable_from_targets");
  assert.equal(reasonBySkill.get("side-b"), "no_consumers");
  assert.equal(reasonBySkill.get("bridge-a"), "unreachable_from_targets");
  assert.equal(reasonBySkill.get("bridge-b"), "no_consumers");
  assert.equal(reasonBySkill.get("orphan"), "no_consumers");
});

test("compileExecutionPlan throws with cycle path when graph is cyclic", () => {
  const manifests = [
    makeManifest("a", { consumes: ["z"], produces: ["x"] }),
    makeManifest("b", { consumes: ["x"], produces: ["y"] }),
    makeManifest("c", { consumes: ["y"], produces: ["z"] }),
  ];

  assert.throws(
    () => compileExecutionPlan(manifests),
    /Cycle detected in dependency graph: a -> b -> c -> a/,
  );
});

test("compileExecutionPlan supports single skill graph", () => {
  const manifests = [makeManifest("solo", { produces: ["x"] })];
  const plan = compileExecutionPlan(manifests, ["x"]);

  assert.deepEqual(plan.levels, [{ depth: 0, skills: ["solo"], isOnCriticalPath: true }]);
  assert.deepEqual(plan.criticalPath, ["solo"]);
  assert.equal(plan.totalDepth, 1);
  assert.equal(plan.maxParallelism, 1);
  assert.deepEqual(plan.prunedSkills, []);
  assert.deepEqual(plan.dependencyEdges, []);
});

test("compileExecutionPlan supports empty input", () => {
  const plan = compileExecutionPlan([]);

  assert.deepEqual(plan.levels, []);
  assert.deepEqual(plan.criticalPath, []);
  assert.equal(plan.totalDepth, 0);
  assert.equal(plan.maxParallelism, 0);
  assert.deepEqual(plan.prunedSkills, []);
  assert.deepEqual(plan.dependencyEdges, []);
});

test("compileExecutionPlan handles complex multi-branch with pruning", () => {
  const manifests = [
    makeManifest("alpha", { produces: ["a"] }),
    makeManifest("beta", { produces: ["b"] }),
    makeManifest("gamma", { consumes: ["a"], produces: ["c"] }),
    makeManifest("delta", { consumes: ["a", "b"], produces: ["d"] }),
    makeManifest("epsilon", { consumes: ["c", "d"], produces: ["out"] }),
    makeManifest("zeta", { consumes: ["d"], produces: ["f"] }),
    makeManifest("eta", { consumes: ["f"], produces: ["g"] }),
    makeManifest("island-a", { produces: ["ia"] }),
    makeManifest("island-b", { consumes: ["ia"], produces: ["ib"] }),
  ];

  const plan = compileExecutionPlan(manifests, ["out"]);

  assert.deepEqual(plan.levels.map((level) => level.skills), [["alpha", "beta"], ["delta", "gamma"], ["epsilon"]]);
  assert.equal(plan.totalDepth, 3);
  assert.equal(plan.maxParallelism, 2);
  assert.deepEqual(plan.criticalPath, ["alpha", "delta", "epsilon"]);

  const prunedNames = plan.prunedSkills.map((entry) => entry.name);
  assert.deepEqual(prunedNames, ["eta", "island-a", "island-b", "zeta"]);

  const reasonBySkill = new Map(plan.prunedSkills.map((entry) => [entry.name, entry.reason]));
  assert.equal(reasonBySkill.get("zeta"), "unreachable_from_targets");
  assert.equal(reasonBySkill.get("eta"), "no_consumers");
  assert.equal(reasonBySkill.get("island-a"), "unreachable_from_targets");
  assert.equal(reasonBySkill.get("island-b"), "no_consumers");
});

test("compileExecutionPlan keeps disconnected subgraphs when no target outputs are provided", () => {
  const manifests = [
    makeManifest("a", { produces: ["x"] }),
    makeManifest("b", { consumes: ["x"], produces: ["y"] }),
    makeManifest("c", { produces: ["z"] }),
  ];

  const plan = compileExecutionPlan(manifests);

  assert.deepEqual(plan.levels.map((level) => level.skills), [["a", "c"], ["b"]]);
  assert.deepEqual(plan.prunedSkills, []);
  assert.equal(plan.maxParallelism, 2);
  assert.deepEqual(plan.criticalPath, ["a", "b"]);
});
