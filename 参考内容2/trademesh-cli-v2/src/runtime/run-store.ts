import fs from "node:fs";
import path from "node:path";
import { RunRecord } from "./types.js";

export interface RunSummary {
  id: string;
  createdAt: string;
  goal: string;
  status: string;
}

export function saveRun(rootDir: string, run: RunRecord): string {
  const file = path.join(rootDir, `${run.id}.json`);
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}

export function updateRun(rootDir: string, run: RunRecord): string {
  return saveRun(rootDir, run);
}

export function loadRun(rootDir: string, id: string): RunRecord {
  const file = path.join(rootDir, `${id}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as RunRecord;
}

export function listRuns(rootDir: string): RunSummary[] {
  if (!fs.existsSync(rootDir)) return [];
  return fs
    .readdirSync(rootDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = path.join(rootDir, name);
      const run = JSON.parse(fs.readFileSync(file, "utf8")) as RunRecord;
      return {
        id: run.id,
        createdAt: run.createdAt,
        goal: run.goal,
        status: run.status,
      } satisfies RunSummary;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
