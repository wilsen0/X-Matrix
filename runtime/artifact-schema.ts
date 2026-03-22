import type { ArtifactKey, ArtifactReference, SkillArtifact } from "./types.js";

const CURRENT_ARTIFACT_VERSIONS: Record<ArtifactKey, number> = {
  "goal.intake": 3,
  "portfolio.snapshot": 3,
  "portfolio.risk-profile": 3,
  "market.snapshot": 3,
  "market.regime": 3,
  "trade.thesis": 3,
  "planning.proposals": 3,
  "planning.scenario-matrix": 3,
  "policy.plan-decision": 3,
  "execution.intent-bundle": 3,
  "execution.apply-decision": 3,
  "execution.idempotency-check": 3,
  "approval.ticket": 3,
  "execution.reconciliation": 3,
  "report.operator-summary": 3,
  "report.operator-brief": 3,
  "mesh.skill-certification": 3,
  "mesh.route-proof": 3,
  "diagnostics.probes": 3,
  "diagnostics.readiness": 3,
  "diagnostics.reason-catalog": 3,
  "operations.live-guard": 3,
  "operations.rehearsal-plan": 3,
  "operations.rehearsal-receipt": 3,
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
