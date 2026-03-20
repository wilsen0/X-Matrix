import { SkillManifest } from "./types.js";

const CHAIN_TEMPLATES: Array<{ match: RegExp; chain: string[] }> = [
  {
    match: /(hedge|drawdown|protect|downside|risk|volatility)/i,
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
    match: /(grid|dca|bot|ladder)/i,
    chain: ["market-scan", "policy-gate", "official-executor", "replay"],
  },
];

function triggeredSkills(goal: string, skills: SkillManifest[]): string[] {
  const lowered = goal.toLowerCase();
  return skills
    .filter((skill) => skill.triggers.some((trigger) => lowered.includes(trigger.toLowerCase())))
    .map((skill) => skill.name);
}

export function routeGoal(goal: string, skills: SkillManifest[]): string[] {
  const selected = CHAIN_TEMPLATES.find((item) => item.match.test(goal));
  const available = new Set(skills.map((skill) => skill.name));
  const templateChain = (selected?.chain ?? ["market-scan", "replay"]).filter((name) => available.has(name));
  const triggerChain = triggeredSkills(goal, skills).filter((name) => available.has(name));
  const merged = [...templateChain, ...triggerChain];
  return merged.filter((name, index) => merged.indexOf(name) === index);
}
