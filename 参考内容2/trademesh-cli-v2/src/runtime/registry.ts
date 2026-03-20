import fs from "node:fs";
import path from "node:path";
import { RiskLevel, SkillManifest } from "./types.js";

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const result: Record<string, string> = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf(":");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (key) result[key] = value;
  }
  return result;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(true|yes|1)$/i.test(value.trim());
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRiskLevel(value: string | undefined): RiskLevel {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function loadSkill(rootDir: string, dirName: string): SkillManifest | null {
  const skillPath = path.join(rootDir, dirName, "SKILL.md");
  if (!fs.existsSync(skillPath)) return null;
  const markdown = fs.readFileSync(skillPath, "utf8");
  const frontmatter = parseFrontmatter(markdown);
  const skill: SkillManifest = {
    name: frontmatter.name ?? dirName,
    description: frontmatter.description ?? "",
    license: frontmatter.license,
    metadata: {},
    path: skillPath,
    writes: parseBoolean(frontmatter.writes, false),
    riskLevel: parseRiskLevel(frontmatter.risk_level),
    triggers: parseList(frontmatter.triggers),
  };
  return skill;
}

export function discoverSkills(rootDir: string): SkillManifest[] {
  if (!fs.existsSync(rootDir)) return [];
  const dirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const skills: SkillManifest[] = [];
  for (const dir of dirs) {
    const skill = loadSkill(rootDir, dir.name);
    if (skill) skills.push(skill);
  }
  return skills;
}
