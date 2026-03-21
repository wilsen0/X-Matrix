import type {
  ArtifactKey,
  ArtifactSnapshot,
  PolicyDecision,
  SkillArtifact,
} from "./types.js";
import { currentArtifactVersion } from "./artifact-schema.js";

type JsonRecord = Record<string, unknown>;

const ARTIFACT_KEYS: ArtifactKey[] = [
  "goal.intake",
  "portfolio.snapshot",
  "portfolio.risk-profile",
  "market.snapshot",
  "market.regime",
  "trade.thesis",
  "planning.proposals",
  "planning.scenario-matrix",
  "policy.plan-decision",
  "execution.intent-bundle",
  "execution.apply-decision",
];

const POLICY_OUTCOMES = new Set<PolicyDecision["outcome"]>(["approved", "require_approval", "blocked"]);
const DOCTRINE_IDS = new Set<string>([
  "turtle-trend",
  "black-swan-risk",
  "vol-hedging",
  "discipline",
]);
const SEVERITIES = new Set<string>(["low", "medium", "high"]);

interface RuleCardLike {
  id: string;
  doctrineId: string;
  appliesTo: string[];
  inputs: string[];
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  priority: number;
  severity: string;
  docPath: string;
}

interface DoctrineCardLike {
  id: string;
  name: string;
  principles: string[];
  defaultWeights: Record<string, number>;
  riskBias: string;
  linkedRuleIds: string[];
  docPath: string;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function asObject(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePolicyDecisionLike(data: unknown, key: ArtifactKey): void {
  const record = asObject(data);
  invariant(record, `Artifact '${key}' must be an object.`);
  if ("outcome" in record) {
    invariant(POLICY_OUTCOMES.has(record.outcome as PolicyDecision["outcome"]), `Artifact '${key}' has an invalid outcome.`);
  }
  if ("proposal" in record) {
    invariant(hasString(record.proposal), `Artifact '${key}' proposal must be a string.`);
  }
}

export function validatePolicyDecision<T extends PolicyDecision | null | undefined>(decision: T): T {
  if (decision === null || decision === undefined) {
    return decision;
  }
  validatePolicyDecisionLike(decision, "policy.plan-decision");
  return decision;
}

export function validateArtifactData(key: ArtifactKey, data: unknown): void {
  if (key === "planning.proposals") {
    invariant(Array.isArray(data), `Artifact '${key}' must be an array.`);
    return;
  }

  if (key === "planning.scenario-matrix") {
    invariant(asObject(data), `Artifact '${key}' must be an object.`);
    return;
  }

  if (key === "policy.plan-decision" || key === "execution.apply-decision") {
    validatePolicyDecisionLike(data, key);
    return;
  }

  if (key === "execution.intent-bundle") {
    const record = asObject(data);
    invariant(record, `Artifact '${key}' must be an object.`);
    if ("intents" in record) {
      invariant(Array.isArray(record.intents), `Artifact '${key}.intents' must be an array.`);
    }
    if ("orderPlan" in record) {
      invariant(Array.isArray(record.orderPlan), `Artifact '${key}.orderPlan' must be an array.`);
    }
    return;
  }

  const record = asObject(data);
  invariant(record, `Artifact '${key}' must be an object.`);

  if (key === "goal.intake") {
    if ("rawGoal" in record) {
      invariant(hasString(record.rawGoal), `Artifact '${key}.rawGoal' must be a string.`);
    }
    if ("symbols" in record) {
      invariant(Array.isArray(record.symbols), `Artifact '${key}.symbols' must be an array.`);
    }
    if ("executePreference" in record) {
      invariant(
        ["plan_only", "dry_run", "execute"].includes(String(record.executePreference)),
        `Artifact '${key}.executePreference' is invalid.`,
      );
    }
    return;
  }

  if (key === "portfolio.snapshot") {
    if ("source" in record) {
      invariant(record.source === "okx-cli" || record.source === "fallback", `Artifact '${key}' has an invalid source.`);
    }
    if ("symbols" in record) {
      invariant(Array.isArray(record.symbols), `Artifact '${key}.symbols' must be an array.`);
    }
    if ("drawdownTarget" in record) {
      invariant(hasString(record.drawdownTarget), `Artifact '${key}.drawdownTarget' must be a string.`);
    }
    return;
  }

  if (key === "portfolio.risk-profile") {
    if ("directionalExposure" in record) {
      invariant(asObject(record.directionalExposure), `Artifact '${key}.directionalExposure' must be an object.`);
    }
    if ("concentration" in record) {
      invariant(asObject(record.concentration), `Artifact '${key}.concentration' must be an object.`);
    }
    return;
  }

  if (key === "market.regime") {
    if ("directionalRegime" in record) {
      invariant(
        ["uptrend", "downtrend", "sideways"].includes(String(record.directionalRegime)),
        `Artifact '${key}.directionalRegime' is invalid.`,
      );
    }
    if ("volState" in record) {
      invariant(
        ["compressed", "normal", "elevated", "stress"].includes(String(record.volState)),
        `Artifact '${key}.volState' is invalid.`,
      );
    }
    return;
  }

  if (key === "trade.thesis") {
    if ("hedgeBias" in record) {
      invariant(
        ["perp", "protective-put", "collar", "de-risk"].includes(String(record.hedgeBias)),
        `Artifact '${key}.hedgeBias' is invalid.`,
      );
    }
    if ("disciplineState" in record) {
      invariant(
        ["normal", "cooldown", "restricted"].includes(String(record.disciplineState)),
        `Artifact '${key}.disciplineState' is invalid.`,
      );
    }
  }
}

export function validateArtifactEnvelope(artifact: SkillArtifact<unknown>): void {
  invariant(ARTIFACT_KEYS.includes(artifact.key), `Unknown artifact key '${artifact.key}'.`);
  invariant(
    artifact.version === currentArtifactVersion(artifact.key),
    `Artifact '${artifact.key}' must use current version ${currentArtifactVersion(artifact.key)}.`,
  );
  invariant(hasString(artifact.producer), `Artifact '${artifact.key}' must have a producer.`);
  invariant(hasString(artifact.createdAt), `Artifact '${artifact.key}' must have a createdAt timestamp.`);
  invariant(Array.isArray(artifact.ruleRefs), `Artifact '${artifact.key}.ruleRefs' must be an array.`);
  invariant(Array.isArray(artifact.doctrineRefs), `Artifact '${artifact.key}.doctrineRefs' must be an array.`);
  validateArtifactData(artifact.key, artifact.data);
}

export function validateArtifactSnapshot(snapshot: ArtifactSnapshot): ArtifactSnapshot {
  invariant(asObject(snapshot), "Artifact snapshot must be an object.");
  for (const [key, artifact] of Object.entries(snapshot)) {
    invariant(artifact, `Artifact snapshot entry '${key}' is empty.`);
    validateArtifactEnvelope(artifact as SkillArtifact<unknown>);
    invariant((artifact as SkillArtifact<unknown>).key === key, `Artifact snapshot entry '${key}' does not match its internal key.`);
  }
  return snapshot;
}

export function validateRuleCard<T extends RuleCardLike>(card: T): T {
  invariant(hasString(card.id), "Rule card id must be a string.");
  invariant(DOCTRINE_IDS.has(card.doctrineId), `Rule card '${card.id}' has an invalid doctrineId.`);
  invariant(Array.isArray(card.appliesTo) && card.appliesTo.length > 0, `Rule card '${card.id}' must declare appliesTo.`);
  invariant(Array.isArray(card.inputs), `Rule card '${card.id}' inputs must be an array.`);
  invariant(Number.isFinite(card.priority), `Rule card '${card.id}' must have a numeric priority.`);
  invariant(SEVERITIES.has(card.severity), `Rule card '${card.id}' has an invalid severity.`);
  invariant(hasString(card.docPath), `Rule card '${card.id}' must have a docPath.`);
  invariant(asObject(card.condition), `Rule card '${card.id}' condition must be an object.`);
  invariant(asObject(card.action), `Rule card '${card.id}' action must be an object.`);
  return card;
}

export function validateDoctrineCard<T extends DoctrineCardLike>(card: T): T {
  invariant(DOCTRINE_IDS.has(card.id), `Doctrine card '${String(card.id)}' is invalid.`);
  invariant(hasString(card.name), `Doctrine card '${card.id}' must have a name.`);
  invariant(isStringArray(card.principles), `Doctrine card '${card.id}' principles must be a string array.`);
  invariant(asObject(card.defaultWeights), `Doctrine card '${card.id}' defaultWeights must be an object.`);
  invariant(hasString(card.riskBias), `Doctrine card '${card.id}' must have a riskBias.`);
  invariant(isStringArray(card.linkedRuleIds), `Doctrine card '${card.id}' linkedRuleIds must be a string array.`);
  invariant(hasString(card.docPath), `Doctrine card '${card.id}' must have a docPath.`);
  return card;
}
