import { SkillManifest } from "./types.js";

const CHAINS: Array<{ match: RegExp; chain: string[] }> = [
  {
    match: /(hedge|drawdown|protect|downside|risk)/i,
    chain: [
      "portfolio-xray",
      "market-scan",
      "hedge-planner",
      "policy-gate",
      "official-executor",
      "replay",
    ],
  },
  {
    match: /(grid|dca|bot)/i,
    chain: ["market-scan", "policy-gate", "official-executor", "replay"],
  },
];

export function routeGoal(goal: string, skills: SkillManifest[]): string[] {
  const selected = CHAINS.find((item) => item.match.test(goal));
  const fallback = ["market-scan", "replay"];
  const desired = selected?.chain ?? fallback;
  const available = new Set(skills.map((skill) => skill.name));
  return desired.filter((name) => available.has(name));
}
