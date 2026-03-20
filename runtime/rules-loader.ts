import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { getProjectPaths } from "./paths.js";
import { validateDoctrineCard, validateRuleCard } from "./contracts.js";
import type { ArtifactKey, DoctrineId, SkillManifest } from "./types.js";

export interface ParsedRule {
  id: string;
  title: string;
  code: string;
  params: Record<string, unknown>;
}

export interface RulesDocument {
  file: string;
  rules: ParsedRule[];
  tables: Array<{ headers: string[]; rows: string[][] }>;
}

export interface RuleCard {
  id: string;
  doctrineId: DoctrineId;
  appliesTo: Array<SkillManifest["name"] | string>;
  inputs: ArtifactKey[];
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  priority: number;
  severity: "low" | "medium" | "high";
  docPath: string;
}

export interface DoctrineCard {
  id: DoctrineId;
  name: string;
  principles: string[];
  defaultWeights: Record<string, number>;
  riskBias: string;
  linkedRuleIds: string[];
  docPath: string;
}

interface RuleCardFile {
  rules: RuleCard[];
}

function projectJoin(...parts: string[]): string {
  return join(getProjectPaths().projectRoot, ...parts);
}

export async function loadRules(filename: string): Promise<RulesDocument> {
  const filepath = projectJoin("docs", "rules", filename);
  const content = await readFile(filepath, "utf-8");

  const rules = extractRules(content);
  const tables = extractTables(content);

  return { file: filename, rules, tables };
}

function extractRules(content: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const codeBlockRegex = /```typescript\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const code = match[1];
    const ruleRegex = /\/\/\s*@rule\s+(\S+)(?:\s+(.*))?/g;
    let ruleMatch: RegExpExecArray | null;

    while ((ruleMatch = ruleRegex.exec(code)) !== null) {
      const id = ruleMatch[1];
      const paramsStr = ruleMatch[2] || "";
      const params: Record<string, string> = {};
      const paramRegex = /(\w+)="([^"]+)"/g;
      let paramMatch: RegExpExecArray | null;
      while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
        params[paramMatch[1]] = paramMatch[2];
      }

      rules.push({
        id,
        title: String(params.description || id),
        code: code.trim(),
        params,
      });
    }

    if (!code.includes("@rule")) {
      const firstLine = code.split("\n")[0];
      const commentMatch = firstLine.match(/\/\/\s*(.+)/);
      if (commentMatch) {
        rules.push({
          id: slugify(commentMatch[1]),
          title: commentMatch[1],
          code: code.trim(),
          params: {},
        });
      }
    }
  }

  return rules;
}

function extractTables(content: string): Array<{ headers: string[]; rows: string[][] }> {
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  const tableRegex = /\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)+)/g;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(content)) !== null) {
    const headers = match[1].split("|").map((header) => header.trim()).filter(Boolean);
    const rows = match[2]
      .trim()
      .split("\n")
      .map((row) => row.split("|").map((cell) => cell.trim()).filter(Boolean));
    tables.push({ headers, rows });
  }

  return tables;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function findRule(doc: RulesDocument, id: string): ParsedRule | undefined {
  return doc.rules.find((rule) => rule.id === id);
}

export function findTableRow(
  table: { headers: string[]; rows: string[][] },
  column: string,
  value: string,
): string[] | undefined {
  const colIndex = table.headers.indexOf(column);
  if (colIndex === -1) {
    return undefined;
  }

  return table.rows.find((row) => row[colIndex] === value);
}

async function loadJson<T>(path: string): Promise<T> {
  const contents = await readFile(path, "utf8");
  return JSON.parse(contents) as T;
}

export async function loadDoctrineCards(): Promise<DoctrineCard[]> {
  const doctrinesRoot = projectJoin("doctrines");
  const entries = await readdir(doctrinesRoot);
  const cards = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map((entry) => loadJson<DoctrineCard>(join(doctrinesRoot, entry))),
  );
  return cards.map((card) => validateDoctrineCard(card));
}

export async function loadRuleCards(): Promise<RuleCard[]> {
  const rulesRoot = projectJoin("rules");
  const entries = await readdir(rulesRoot);
  const files = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".rule.json"))
      .sort()
      .map((entry) => loadJson<RuleCardFile>(join(rulesRoot, entry))),
  );

  return files.flatMap((file) => file.rules).map((card) => validateRuleCard(card));
}

export async function validateRuleDocs(): Promise<{
  ok: boolean;
  missingInDocs: string[];
  extraInDocs: string[];
}> {
  const ruleCards = await loadRuleCards();
  const markdownDocs = await Promise.all(
    ["trend-following.md", "risk-limits.md", "hedging-strats.md"].map((filename) => loadRules(filename)),
  );
  const docRuleIds = new Set(markdownDocs.flatMap((doc) => doc.rules.map((rule) => rule.id)));
  const canonicalRuleIds = new Set(ruleCards.map((rule) => rule.id));

  const missingInDocs = [...canonicalRuleIds].filter((id) => !docRuleIds.has(id)).sort();
  const extraInDocs = [...docRuleIds].filter((id) => !canonicalRuleIds.has(id)).sort();

  return {
    ok: missingInDocs.length === 0,
    missingInDocs,
    extraInDocs,
  };
}
