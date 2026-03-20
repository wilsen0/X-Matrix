import { readFile } from "fs/promises";
import { join } from "path";

/**
 * 解析后的规则
 */
export interface ParsedRule {
  id: string;
  title: string;
  code: string;
  params: Record<string, unknown>;
}

/**
 * 规则文档
 */
export interface RulesDocument {
  file: string;
  rules: ParsedRule[];
  tables: Array<{ headers: string[]; rows: string[][] }>;
}

/**
 * 从 markdown 文件加载规则
 * 
 * 解析两种格式：
 * 1. 代码块注释标记: // @rule <id> [key=value ...]
 * 2. 表格: 自动提取 headers + rows
 */
export async function loadRules(filename: string): Promise<RulesDocument> {
  const filepath = join(process.cwd(), "docs/rules", filename);
  const content = await readFile(filepath, "utf-8");
  
  const rules = extractRules(content);
  const tables = extractTables(content);
  
  return { file: filename, rules, tables };
}

/**
 * 从代码块提取规则
 * 
 * 示例:
 * ```typescript
 * // @rule max-single-order description="单笔限额"
 * const maxSingleOrderNotionalUsd = accountEquity * 0.02;
 * ```
 */
function extractRules(content: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  
  // 匹配 ```typescript 代码块
  const codeBlockRegex = /```typescript\n([\s\S]*?)```/g;
  let match;
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const code = match[1];
    
    // 查找 @rule 标记
    const ruleRegex = /\/\/\s*@rule\s+(\S+)(?:\s+(.*))?/g;
    let ruleMatch;
    
    while ((ruleMatch = ruleRegex.exec(code)) !== null) {
      const id = ruleMatch[1];
      const paramsStr = ruleMatch[2] || "";
      
      // 解析 key=value 参数
      const params: Record<string, string> = {};
      const paramRegex = /(\w+)="([^"]+)"/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
        params[paramMatch[1]] = paramMatch[2];
      }
      
      rules.push({
        id,
        title: params.description || id,
        code: code.trim(),
        params,
      });
    }
    
    // 如果没有 @rule 标记，用代码块第一行注释作为标题
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

/**
 * 从 markdown 提取表格
 */
function extractTables(content: string): Array<{ headers: string[]; rows: string[][] }> {
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  
  const tableRegex = /\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)+)/g;
  let match;
  
  while ((match = tableRegex.exec(content)) !== null) {
    const headers = match[1].split("|").map(h => h.trim()).filter(Boolean);
    const rowsStr = match[2];
    const rows = rowsStr
      .trim()
      .split("\n")
      .map(row => row.split("|").map(cell => cell.trim()).filter(Boolean));
    
    tables.push({ headers, rows });
  }
  
  return tables;
}

/**
 * 字符串转 slug
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 查找规则 by ID
 */
export function findRule(doc: RulesDocument, id: string): ParsedRule | undefined {
  return doc.rules.find(r => r.id === id);
}

/**
 * 从表格查找行 by 列值
 */
export function findTableRow(
  table: { headers: string[]; rows: string[][] },
  column: string,
  value: string
): string[] | undefined {
  const colIndex = table.headers.indexOf(column);
  if (colIndex === -1) return undefined;
  
  return table.rows.find(row => row[colIndex] === value);
}
