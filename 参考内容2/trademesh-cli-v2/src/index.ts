import path from "node:path";
import process from "node:process";
import { discoverSkills } from "./runtime/registry.js";
import { inspectOkxEnvironment, executeIntent } from "./runtime/okx.js";
import { buildRun, inferPlane } from "./runtime/planner.js";
import { evaluatePolicy } from "./runtime/policy.js";
import { routeGoal } from "./runtime/router.js";
import { listRuns, loadRun, saveRun, updateRun } from "./runtime/run-store.js";
import { CliOptions, Plane, ProposalOption, RunRecord, RunStatus } from "./runtime/types.js";

const root = process.cwd();
const skillsDir = path.join(root, "skills");
const runsDir = path.join(root, "runs");

function printHelp(): void {
  console.log(`TradeMesh CLI

Commands:
  skills list [--json]
  doctor [--json]
  plan <goal> [--plane research|demo|live] [--json]
  apply <run-id> [--proposal <name>] [--execute] [--approve] [--json]
  replay <run-id> [--json]
  runs list [--json]
`);
}

function parseArgs(args: string[]): { positionals: string[]; options: CliOptions } {
  const positionals: string[] = [];
  const options: CliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--approve") {
      options.approve = true;
      continue;
    }
    if (arg === "--plane" && args[index + 1]) {
      options.plane = args[index + 1] as Plane;
      index += 1;
      continue;
    }
    if (arg.startsWith("--plane=")) {
      options.plane = arg.split("=", 2)[1] as Plane;
      continue;
    }
    if (arg === "--proposal" && args[index + 1]) {
      options.proposal = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--proposal=")) {
      options.proposal = arg.split("=", 2)[1];
      continue;
    }
    positionals.push(arg);
  }

  return { positionals, options };
}

function emit(value: unknown, asJson: boolean | undefined): void {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function resolveProposal(run: RunRecord, proposalName?: string): ProposalOption {
  if (!proposalName) return run.proposals[0];
  const proposal = run.proposals.find((item) => item.name === proposalName);
  if (!proposal) throw new Error(`proposal '${proposalName}' was not found in run ${run.id}`);
  return proposal;
}

function nextStatusFromPolicy(outcome: "approved" | "require_approval" | "blocked", execute: boolean): RunStatus {
  if (outcome === "blocked") return "blocked";
  if (outcome === "require_approval") return "approval_required";
  return execute ? "executed" : "dry_run";
}

async function main(): Promise<void> {
  const { positionals, options } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  const skills = discoverSkills(skillsDir);

  if (!command) {
    printHelp();
    return;
  }

  if (command === "skills" && positionals[1] === "list") {
    emit(skills, options.json);
    return;
  }

  if (command === "doctor") {
    const env = inspectOkxEnvironment();
    emit(
      {
        ok: env.okxCliAvailable && env.configExists,
        environment: env,
        discoveredSkills: skills.length,
        recommendations: [
          "Use a dedicated sub-account for automation.",
          "Keep demo and live profiles separate.",
          "Route all writes through the official executor only.",
        ],
      },
      true,
    );
    return;
  }

  if (command === "plan") {
    const goal = positionals.slice(1).join(" ").trim();
    if (!goal) throw new Error("plan requires a goal string");
    const plane = inferPlane(goal, options.plane);
    const chain = routeGoal(goal, skills);
    const run = buildRun(goal, chain, plane);
    const file = saveRun(runsDir, run);
    emit(
      {
        runId: run.id,
        file,
        plane,
        chain: run.chain,
        status: run.status,
        proposals: run.proposals.map((proposal) => ({
          name: proposal.name,
          reason: proposal.reason,
          requiredModules: proposal.requiredModules,
          writeIntents: proposal.intents.filter((intent) => intent.requiresWrite).length,
        })),
        capabilitySnapshot: run.capabilitySnapshot,
      },
      true,
    );
    return;
  }

  if (command === "apply") {
    const id = positionals[1];
    if (!id) throw new Error("apply requires a run id");
    const run = loadRun(runsDir, id);
    const proposal = resolveProposal(run, options.proposal);
    const policyDecision = evaluatePolicy(run, proposal, Boolean(options.approve));
    run.policyDecision = policyDecision;

    if (policyDecision.outcome !== "approved") {
      run.status = nextStatusFromPolicy(policyDecision.outcome, false);
      run.executions.push({
        requestedAt: new Date().toISOString(),
        mode: options.execute ? "execute" : "dry-run",
        plane: run.permissions.plane,
        proposal: proposal.name,
        approvalProvided: Boolean(options.approve),
        status: run.status,
        results: proposal.intents.map((intent) => ({
          intent,
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          skipped: true,
          dryRun: !options.execute,
        })),
        blockedReason: policyDecision.reasons.join("; "),
      });
      updateRun(runsDir, run);
      emit({ runId: run.id, status: run.status, policyDecision }, true);
      return;
    }

    const results = proposal.intents.map((intent) => executeIntent(intent, Boolean(options.execute)));
    const ok = results.every((result) => result.ok);
    run.status = ok ? nextStatusFromPolicy(policyDecision.outcome, Boolean(options.execute)) : "failed";
    run.approved = true;
    run.executions.push({
      requestedAt: new Date().toISOString(),
      mode: options.execute ? "execute" : "dry-run",
      plane: run.permissions.plane,
      proposal: proposal.name,
      approvalProvided: Boolean(options.approve),
      status: run.status,
      results,
    });
    updateRun(runsDir, run);
    emit({ runId: run.id, status: run.status, policyDecision, execution: run.executions.at(-1) }, true);
    return;
  }

  if (command === "replay") {
    const id = positionals[1];
    if (!id) throw new Error("replay requires a run id");
    const run = loadRun(runsDir, id);
    emit(run, true);
    return;
  }

  if (command === "runs" && positionals[1] === "list") {
    emit(listRuns(runsDir), true);
    return;
  }

  printHelp();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
