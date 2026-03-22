import { existsSync, promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getProjectPaths } from "./paths.js";
import type {
  ArtifactKey,
  SkillDeterminism,
  SkillHandler,
  SkillManifest,
  SkillProofClass,
  SkillRole,
  SkillSafetyClass,
} from "./types.js";

type FrontmatterValue = string | number | boolean | string[];

function parseScalar(rawValue: string): FrontmatterValue {
  const value = rawValue.trim();

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.replace(/^['"]|['"]$/g, ""));
  }

  return value.replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(markdown: string): Record<string, FrontmatterValue> {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return {};
  }

  const values: Record<string, FrontmatterValue> = {};

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") {
      break;
    }

    if (!line.trim()) {
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1);
    values[key] = parseScalar(rawValue);
  }

  return values;
}

function parseListValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function defaultRoleForStage(stage: SkillManifest["stage"]): SkillRole {
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

function assertManifest(condition: unknown, message: string, path: string): asserts condition {
  if (!condition) {
    throw new Error(`Skill manifest error (${path}): ${message}`);
  }
}

function normalizeManifest(path: string, fields: Record<string, FrontmatterValue>): SkillManifest {
  const name = typeof fields.name === "string" ? fields.name : "";
  if (!name) {
    throw new Error(`Skill manifest missing name: ${path}`);
  }

  const stage =
    typeof fields.stage === "string"
      ? (fields.stage as SkillManifest["stage"])
      : "sensor";
  const consumes = parseListValue(fields.consumes) as ArtifactKey[];
  const produces = parseListValue(fields.produces) as ArtifactKey[];
  const standaloneRoute = parseListValue(fields.standalone_route);
  const standaloneInputs = parseListValue(fields.standalone_inputs) as Array<"goal" | "run-id" | ArtifactKey>;
  const standaloneOutputs = parseListValue(fields.standalone_outputs) as ArtifactKey[];
  const contractVersion =
    typeof fields.contract_version === "number"
      ? fields.contract_version
      : typeof fields.contract_version === "string"
        ? Number(fields.contract_version)
        : 1;
  const safetyClass =
    typeof fields.safety_class === "string"
      ? (fields.safety_class as SkillSafetyClass)
      : (fields.writes ? "write" : "read");
  const determinism =
    typeof fields.determinism === "string"
      ? (fields.determinism as SkillDeterminism)
      : "medium";
  const proofClass =
    typeof fields.proof_class === "string"
      ? (fields.proof_class as SkillProofClass)
      : "structural";
  const proofGoal = typeof fields.proof_goal === "string" ? fields.proof_goal.trim() : undefined;
  const proofFixtureRaw = typeof fields.proof_fixture === "string" ? fields.proof_fixture.trim() : undefined;
  const proofTargetOutputs = parseListValue(fields.proof_target_outputs) as ArtifactKey[];
  const proofFixture = proofFixtureRaw ? resolve(dirname(path), proofFixtureRaw) : undefined;

  assertManifest(standaloneRoute.length > 0, "standalone_route must be non-empty", path);
  assertManifest(
    standaloneRoute[standaloneRoute.length - 1] === name,
    `standalone_route must end with '${name}'`,
    path,
  );
  if (name !== "replay") {
    const overlap = standaloneOutputs.some((key) => produces.includes(key));
    assertManifest(
      overlap,
      "standalone_outputs must include at least one artifact produced by this skill",
      path,
    );
  }
  assertManifest(contractVersion === 1, "contract_version must be 1", path);
  assertManifest(
    safetyClass === "read" || safetyClass === "write" || safetyClass === "mixed",
    "safety_class must be one of read|write|mixed",
    path,
  );
  assertManifest(
    determinism === "high" || determinism === "medium" || determinism === "low",
    "determinism must be one of high|medium|low",
    path,
  );
  assertManifest(
    proofClass === "portable" || proofClass === "structural",
    "proof_class must be one of portable|structural",
    path,
  );
  if (proofClass === "portable") {
    assertManifest(Boolean(proofGoal), "proof_goal is required for portable skills", path);
    assertManifest(Boolean(proofFixture), "proof_fixture is required for portable skills", path);
    assertManifest(proofTargetOutputs.length > 0, "proof_target_outputs must be non-empty for portable skills", path);
  }

  return {
    name,
    description: typeof fields.description === "string" ? fields.description : "",
    stage,
    role:
      typeof fields.role === "string"
        ? (fields.role as SkillRole)
        : defaultRoleForStage(stage),
    requires: parseListValue(fields.requires),
    riskLevel:
      typeof fields.risk_level === "string"
        ? (fields.risk_level as SkillManifest["riskLevel"])
        : "low",
    writes: Boolean(fields.writes),
    alwaysOn: Boolean(fields.always_on),
    triggers: parseListValue(fields.triggers),
    entrypoint: typeof fields.entrypoint === "string" ? fields.entrypoint : undefined,
    consumes,
    produces,
    preferredHandoffs: parseListValue(fields.preferred_handoffs),
    repeatable: Boolean(fields.repeatable),
    artifactVersion:
      typeof fields.artifact_version === "number"
        ? fields.artifact_version
        : typeof fields.artifact_version === "string"
          ? Number(fields.artifact_version)
          : 1,
    standaloneCommand:
      typeof fields.standalone_command === "string"
        ? fields.standalone_command
        : `trademesh skills run ${name} "<goal>"`,
    standaloneRoute,
    standaloneInputs,
    standaloneOutputs,
    requiredCapabilities: parseListValue(fields.required_capabilities) as SkillManifest["requiredCapabilities"],
    contractVersion,
    safetyClass,
    determinism,
    proofClass,
    proofGoal,
    proofFixture,
    proofTargetOutputs,
    path,
  };
}

function validateManifestReferences(manifests: SkillManifest[]): void {
  const names = new Set(manifests.map((manifest) => manifest.name));
  for (const manifest of manifests) {
    for (const step of manifest.standaloneRoute) {
      assertManifest(
        names.has(step),
        `standalone_route references unknown skill '${step}'`,
        manifest.path,
      );
    }
    for (const handoff of manifest.preferredHandoffs) {
      assertManifest(
        names.has(handoff),
        `preferred_handoffs references unknown skill '${handoff}'`,
        manifest.path,
      );
    }
  }
}

export async function loadSkillRegistry(): Promise<SkillManifest[]> {
  const { skillsRoot } = getProjectPaths();
  const directoryEntries = await fs.readdir(skillsRoot, { withFileTypes: true });
  const manifests: SkillManifest[] = [];

  for (const entry of directoryEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = join(skillsRoot, entry.name, "SKILL.md");
    if (!existsSync(manifestPath)) {
      continue;
    }

    const markdown = await fs.readFile(manifestPath, "utf8");
    manifests.push(normalizeManifest(manifestPath, parseFrontmatter(markdown)));
  }

  validateManifestReferences(manifests);

  return manifests.sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadSkillHandler(manifest: SkillManifest): Promise<SkillHandler | null> {
  if (!manifest.entrypoint) {
    return null;
  }

  const { distRoot } = getProjectPaths();
  const modulePath = resolve(distRoot, "skills", manifest.name, manifest.entrypoint.replace("./", ""));
  if (!existsSync(modulePath)) {
    return null;
  }

  const imported = (await import(pathToFileURL(modulePath).href)) as { default?: SkillHandler };

  if (typeof imported.default !== "function") {
    throw new Error(`Skill entrypoint for ${manifest.name} does not export a default handler`);
  }

  return imported.default;
}
