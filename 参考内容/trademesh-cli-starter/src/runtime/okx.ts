import { OkxCommandIntent, Plane } from "./types.js";

export function buildOkxCommandIntents(goal: string, plane: Plane): OkxCommandIntent[] {
  const baseFlags = plane === "demo" ? "--profile demo --json" : "--json";

  if (/(hedge|drawdown|protect)/i.test(goal)) {
    return [
      {
        module: "account",
        requiresWrite: false,
        command: `okx account balance ${baseFlags}`,
      },
      {
        module: "account",
        requiresWrite: false,
        command: `okx account positions ${baseFlags}`,
      },
      {
        module: "market",
        requiresWrite: false,
        command: `okx market ticker BTC-USDT ${baseFlags}`,
      },
      {
        module: "option",
        requiresWrite: true,
        command: `okx option place --instId BTC-USD-260327-90000-P --side buy --ordType market --sz 1 ${baseFlags}`,
      },
    ];
  }

  return [
    {
      module: "market",
      requiresWrite: false,
      command: `okx market ticker BTC-USDT ${baseFlags}`,
    },
  ];
}
