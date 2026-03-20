import fs from "node:fs";
import path from "node:path";
import { SkillManifest } from "./types.js";

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const result: Record<string, string> = {};
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (key && value) result[key] = value;
  }
  return result;
}

export function discoverSkills(rootDir: string): SkillManifest[] {
  if (!fs.existsSync(rootDir)) return [];
  const dirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  return dirs
    .map((dir) => {
      const skillPath = path.join(rootDir, dir.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) return null;
      const markdown = fs.readFileSync(skillPath, "utf8");
      const frontmatter = parseFrontmatter(markdown);
      return {
        name: frontmatter.name ?? dir.name,
        description: frontmatter.description ?? "",
        license: frontmatter.license,
        metadata: {},
        path: skillPath,
      } satisfies SkillManifest;
    })
    .filter((skill): skill is SkillManifest => Boolean(skill));
}
