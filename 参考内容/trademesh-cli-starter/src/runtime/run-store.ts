import fs from "node:fs";
import path from "node:path";
import { RunRecord } from "./types.js";

export function saveRun(rootDir: string, run: RunRecord): string {
  const file = path.join(rootDir, `${run.id}.json`);
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}

export function loadRun(rootDir: string, id: string): RunRecord {
  const file = path.join(rootDir, `${id}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as RunRecord;
}

export function listRuns(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  return fs.readdirSync(rootDir).filter((name) => name.endsWith(".json"));
}
