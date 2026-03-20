import { existsSync, promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getProjectPaths } from "./paths.js";
import type { SkillHandler, SkillManifest } from "./types.js";

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

function normalizeManifest(path: string, fields: Record<string, FrontmatterValue>): SkillManifest {
  const name = typeof fields.name === "string" ? fields.name : "";
  if (!name) {
    throw new Error(`Skill manifest missing name: ${path}`);
  }

  return {
    name,
    description: typeof fields.description === "string" ? fields.description : "",
    stage:
      typeof fields.stage === "string"
        ? (fields.stage as SkillManifest["stage"])
        : "sensor",
    requires: parseListValue(fields.requires),
    riskLevel:
      typeof fields.risk_level === "string"
        ? (fields.risk_level as SkillManifest["riskLevel"])
        : "low",
    writes: Boolean(fields.writes),
    alwaysOn: Boolean(fields.always_on),
    triggers: parseListValue(fields.triggers),
    entrypoint: typeof fields.entrypoint === "string" ? fields.entrypoint : undefined,
    path,
  };
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
