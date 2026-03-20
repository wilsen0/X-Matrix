#!/usr/bin/env node

import { mkdir, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const runsRoot = join(projectRoot, "runs");
const meshRunsRoot = join(projectRoot, ".trademesh", "runs");
const archiveRoot = join(projectRoot, ".trademesh", "archive");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const targetRoot = join(archiveRoot, `dev-state-${stamp}`);

async function moveIfExists(source, target) {
  if (!existsSync(source)) {
    return false;
  }

  await mkdir(join(target, ".."), { recursive: true });
  await rename(source, target);
  return true;
}

async function ensureDir(path) {
  if (!existsSync(path)) {
    await mkdir(path, { recursive: true });
  }
}

async function main() {
  await ensureDir(archiveRoot);
  await ensureDir(targetRoot);

  const movedRuns = await moveIfExists(runsRoot, join(targetRoot, "runs"));
  const movedMeshRuns = await moveIfExists(meshRunsRoot, join(targetRoot, "mesh-runs"));

  await ensureDir(runsRoot);
  await ensureDir(meshRunsRoot);

  const archived = [];
  if (movedRuns) {
    const info = await stat(join(targetRoot, "runs"));
    archived.push(`runs -> ${join(targetRoot, "runs")} (${info.isDirectory() ? "dir" : "file"})`);
  }
  if (movedMeshRuns) {
    const info = await stat(join(targetRoot, "mesh-runs"));
    archived.push(`.trademesh/runs -> ${join(targetRoot, "mesh-runs")} (${info.isDirectory() ? "dir" : "file"})`);
  }

  if (archived.length === 0) {
    console.log("No dev run state found. Nothing was moved.");
    return;
  }

  console.log("Archived dev run state:");
  for (const line of archived) {
    console.log(`- ${line}`);
  }
  console.log("Recreated empty runs/ and .trademesh/runs/.");
  console.log("profiles/ was not touched.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
