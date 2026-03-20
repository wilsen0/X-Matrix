import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../dist/runtime/artifacts.js";

const REFERENCE_RUN_PATH = join(process.cwd(), "参考内容", "example_demo_run.json");

function shellSafeJson(payload) {
  return JSON.stringify(payload).replace(/'/g, `'\"'\"'`);
}

export async function loadReferenceRunFixture() {
  const raw = await readFile(REFERENCE_RUN_PATH, "utf8");
  return JSON.parse(raw);
}

export async function buildReferencePayloads() {
  const fixture = await loadReferenceRunFixture();
  const protectivePut = fixture.proposals.find((proposal) => proposal.name === "protective-put");
  const intent = protectivePut?.cliIntents?.find((command) => command.includes("--instId"));
  const instIdMatch = typeof intent === "string" ? intent.match(/--instId\s+([^\s]+)/) : null;
  const optionInstId = instIdMatch?.[1] ?? "BTC-USD-260327-90000-P";

  return {
    optionInstId,
    accountBalance: {
      code: "0",
      data: [{ details: [{ ccy: "USDT", availBal: "20000", usdEq: "20000" }] }],
    },
    accountPositions: {
      code: "0",
      data: [{ instId: "BTC-USDT-SWAP", pos: "0.01", markPx: "70000", lever: "3", posSide: "long" }],
    },
    accountFeeRates: {
      code: "0",
      data: [{ maker: "-0.0002", taker: "0.0005", makerFeeRate: "-0.0002", takerFeeRate: "0.0005" }],
    },
    accountBills: {
      code: "0",
      data: [{ fee: "-1.20", ccy: "USDT" }],
    },
    marketTicker: {
      code: "0",
      data: [{ instId: "BTC-USDT", last: "70000", open24h: "69000", markPx: "69980" }],
    },
    marketCandles: {
      code: "0",
      data: [
        [Date.now().toString(), "69000", "70100", "68800", "70000", "100"],
        [(Date.now() - 3600_000).toString(), "68800", "69200", "68500", "69000", "120"],
      ],
    },
    marketFundingRate: {
      code: "0",
      data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.0001" }],
    },
    marketOrderbook: {
      code: "0",
      data: [{ bids: [["69990", "5"]], asks: [["70010", "4"]] }],
    },
    swapPlaceOrder: {
      code: "0",
      data: [{ sCode: "0", sMsg: "ok" }],
    },
    optionPlaceOrder: {
      code: "0",
      data: [{ sCode: "0", sMsg: "ok" }],
    },
  };
}

export async function withMockOkx(payloads, fn) {
  const dir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-test-"));
  const scriptPath = join(dir, "okx");
  const script = `#!/usr/bin/env bash
set -euo pipefail
cmd1="\${1-}"
cmd2="\${2-}"
if [[ "$cmd1" == "account" && "$cmd2" == "balance" ]]; then
  echo '${shellSafeJson(payloads.accountBalance)}'
  exit 0
fi
if [[ "$cmd1" == "account" && "$cmd2" == "positions" ]]; then
  echo '${shellSafeJson(payloads.accountPositions)}'
  exit 0
fi
if [[ "$cmd1" == "account" && "$cmd2" == "fee-rates" ]]; then
  echo '${shellSafeJson(payloads.accountFeeRates)}'
  exit 0
fi
if [[ "$cmd1" == "account" && "$cmd2" == "bills" ]]; then
  echo '${shellSafeJson(payloads.accountBills)}'
  exit 0
fi
if [[ "$cmd1" == "market" && "$cmd2" == "ticker" ]]; then
  echo '${shellSafeJson(payloads.marketTicker)}'
  exit 0
fi
if [[ "$cmd1" == "market" && "$cmd2" == "candles" ]]; then
  echo '${shellSafeJson(payloads.marketCandles)}'
  exit 0
fi
if [[ "$cmd1" == "market" && "$cmd2" == "funding-rate" ]]; then
  echo '${shellSafeJson(payloads.marketFundingRate)}'
  exit 0
fi
if [[ "$cmd1" == "market" && "$cmd2" == "orderbook" ]]; then
  echo '${shellSafeJson(payloads.marketOrderbook)}'
  exit 0
fi
if [[ "$cmd1" == "swap" && "$cmd2" == "place-order" ]]; then
  echo '${shellSafeJson(payloads.swapPlaceOrder)}'
  exit 0
fi
if [[ "$cmd1" == "option" && "$cmd2" == "place-order" ]]; then
  echo '${shellSafeJson(payloads.optionPlaceOrder)}'
  exit 0
fi
echo '{"code":"0","data":[]}'
`;
  await writeFile(scriptPath, script, { mode: 0o755 });

  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${dir}:${previousPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = previousPath;
    await rm(dir, { recursive: true, force: true });
  }
}

export function createContext({
  runId = "run_test",
  goal = "hedge my btc drawdown with demo first",
  plane = "demo",
  stage = "sensor",
  skill = "test-skill",
  sharedState = {},
  runtimeInput = {},
  trace = [],
} = {}) {
  const artifacts = createArtifactStore(undefined, sharedState);
  return {
    runId,
    goal,
    plane,
    manifest: {
      name: skill,
      description: `${skill} test manifest`,
      stage,
      role:
        stage === "sensor"
          ? "sensor"
          : stage === "planner"
            ? "planner"
            : stage === "guardrail"
              ? "guardrail"
              : stage === "executor"
                ? "executor"
                : "memory",
      requires: [],
      riskLevel: "low",
      writes: false,
      alwaysOn: false,
      triggers: [],
      entrypoint: "./run.js",
      consumes: [],
      produces: [],
      preferredHandoffs: [],
      repeatable: false,
      artifactVersion: 2,
      path: "tests",
    },
    manifests: [],
    trace,
    artifacts,
    runtimeInput,
    sharedState,
  };
}
