import path from "node:path";
import process from "node:process";
import { discoverSkills } from "./runtime/registry.js";
import { buildRun } from "./runtime/planner.js";
import { routeGoal } from "./runtime/router.js";
import { listRuns, loadRun, saveRun } from "./runtime/run-store.js";

const root = process.cwd();
const skillsDir = path.join(root, "skills");
const runsDir = path.join(root, "runs");

function printHelp(): void {
  console.log(`TradeMesh CLI Starter

Commands:
  skills list
  doctor
  plan <goal>
  replay <run-id>
  runs list
`);
}

function doctor(): void {
  console.log("[doctor] expected runtime contracts");
  console.log("- okx CLI available on PATH");
  console.log("- ~/.okx/config.toml configured");
  console.log("- demo and live profiles separated");
  console.log("- custom skills do not write directly");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const skills = discoverSkills(skillsDir);

  if (!command) {
    printHelp();
    return;
  }

  if (command === "skills" && args[1] === "list") {
    for (const skill of skills) {
      console.log(`${skill.name}\t${skill.description}`);
    }
    return;
  }

  if (command === "doctor") {
    doctor();
    return;
  }

  if (command === "plan") {
    const goal = args.slice(1).join(" ").trim();
    if (!goal) {
      throw new Error("plan requires a goal string");
    }
    const chain = routeGoal(goal, skills);
    const run = buildRun(goal, chain);
    const file = saveRun(runsDir, run);
    console.log(JSON.stringify({ runId: run.id, file, chain: run.chain, proposals: run.proposals }, null, 2));
    return;
  }

  if (command === "replay") {
    const id = args[1];
    if (!id) throw new Error("replay requires a run id");
    const run = loadRun(runsDir, id);
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  if (command === "runs" && args[1] === "list") {
    console.log(JSON.stringify(listRuns(runsDir), null, 2));
    return;
  }

  printHelp();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
