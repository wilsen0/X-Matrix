import { existsSync, promises as fs } from "node:fs";
import { join } from "node:path";
import { getProjectPaths } from "./paths.js";
import type { RunErrorRecord, RunRecord, SkillOutput } from "./types.js";

export interface TraceEnvelope {
  runId: string;
  goal: string;
  plane: RunRecord["plane"];
  status: RunRecord["status"];
  createdAt: string;
  updatedAt: string;
  trace: SkillOutput[];
  executions: RunRecord["executions"];
  errors: RunErrorRecord[];
  policyDecision?: RunRecord["policyDecision"];
}

function timestampPrefix(date = new Date()): string {
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
}

export async function ensureRunsDirectory(): Promise<void> {
  const { runsRoot } = getProjectPaths();
  if (!existsSync(runsRoot)) {
    await fs.mkdir(runsRoot, { recursive: true });
  }
}

async function ensureMeshRunsDirectory(): Promise<void> {
  const { meshRunsRoot } = getProjectPaths();
  if (!existsSync(meshRunsRoot)) {
    await fs.mkdir(meshRunsRoot, { recursive: true });
  }
}

async function ensureMeshRunDirectory(runId: string): Promise<string> {
  await ensureMeshRunsDirectory();
  const { meshRunsRoot } = getProjectPaths();
  const runDir = join(meshRunsRoot, runId);
  if (!existsSync(runDir)) {
    await fs.mkdir(runDir, { recursive: true });
  }
  return runDir;
}

function buildTraceEnvelope(record: RunRecord): TraceEnvelope {
  return {
    runId: record.id,
    goal: record.goal,
    plane: record.plane,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    trace: record.trace,
    executions: record.executions,
    errors: record.errors ?? [],
    policyDecision: record.policyDecision,
  };
}

export async function createRunId(): Promise<string> {
  await ensureRunsDirectory();
  const nonce = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `run_${timestampPrefix(new Date())}_${nonce}`;
}

export async function saveRun(record: RunRecord): Promise<void> {
  await ensureRunsDirectory();
  const { runsRoot } = getProjectPaths();
  const filePath = join(runsRoot, `${record.id}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  const runDir = await ensureMeshRunDirectory(record.id);
  const tracePath = join(runDir, "trace.json");
  const envelope = buildTraceEnvelope(record);
  await fs.writeFile(tracePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

export async function loadRun(runId: string): Promise<RunRecord> {
  const { runsRoot } = getProjectPaths();
  const filePath = join(runsRoot, `${runId}.json`);
  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents) as RunRecord;
}

export async function loadTraceEnvelope(runId: string): Promise<TraceEnvelope | null> {
  const { meshRunsRoot } = getProjectPaths();
  const tracePath = join(meshRunsRoot, runId, "trace.json");

  if (existsSync(tracePath)) {
    const contents = await fs.readFile(tracePath, "utf8");
    const parsed = JSON.parse(contents) as Partial<TraceEnvelope>;
    if (parsed && Array.isArray(parsed.trace)) {
      return {
        runId: typeof parsed.runId === "string" ? parsed.runId : runId,
        goal: typeof parsed.goal === "string" ? parsed.goal : "",
        plane:
          parsed.plane === "research" || parsed.plane === "demo" || parsed.plane === "live"
            ? parsed.plane
            : "research",
        status: typeof parsed.status === "string" ? (parsed.status as RunRecord["status"]) : "planned",
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
        trace: parsed.trace,
        executions: Array.isArray(parsed.executions) ? parsed.executions : [],
        errors: Array.isArray(parsed.errors) ? parsed.errors : [],
        policyDecision: parsed.policyDecision,
      };
    }
  }

  try {
    const run = await loadRun(runId);
    return buildTraceEnvelope(run);
  } catch {
    return null;
  }
}

export async function loadTraceEntries(runId: string): Promise<SkillOutput[]> {
  const envelope = await loadTraceEnvelope(runId);
  return envelope?.trace ?? [];
}

export async function listRunIds(): Promise<string[]> {
  await ensureRunsDirectory();
  const { runsRoot } = getProjectPaths();
  const entries = await fs.readdir(runsRoot);
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.replace(/\.json$/, ""))
    .sort();
}
