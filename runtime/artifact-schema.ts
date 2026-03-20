import type { ArtifactKey, ArtifactReference, SkillArtifact } from "./types.js";

const CURRENT_ARTIFACT_VERSIONS: Record<ArtifactKey, number> = {
  "portfolio.snapshot": 2,
  "portfolio.risk-profile": 2,
  "market.snapshot": 2,
  "market.regime": 2,
  "trade.thesis": 2,
  "planning.proposals": 2,
  "planning.scenario-matrix": 2,
  "policy.plan-decision": 2,
  "execution.intent-bundle": 2,
  "execution.apply-decision": 2,
};

export function currentArtifactVersion(key: ArtifactKey): number {
  return CURRENT_ARTIFACT_VERSIONS[key];
}

export function artifactReference(
  artifact: SkillArtifact<unknown> | undefined,
  key: ArtifactKey,
  fallbackProducer?: string,
): ArtifactReference {
  return {
    key,
    producer: artifact?.producer ?? fallbackProducer,
    version: artifact?.version ?? currentArtifactVersion(key),
  };
}
