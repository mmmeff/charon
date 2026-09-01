import type {
  AgentRun,
  UltraReviewArtifact,
  UltraReviewGenerationFailure,
  UltraReviewGenerationStage,
} from "../types";

const INTERRUPTION_STAGE_ID = "analysis-interrupted";
const INTERRUPTION_FAILURE_ID = "analysis-interrupted";
const INTERRUPTION_MESSAGE =
  "Analysis stopped when Charon restarted.";

type UltraReviewRun = Pick<
  AgentRun,
  "relation" | "repo" | "prNumber" | "status"
>;

function isUltraReviewRun(run: UltraReviewRun): boolean {
  return run.relation === "build UltraReview"
    || run.relation === "retry UltraReview analysis";
}

function isActiveUltraReviewRun(
  artifact: UltraReviewArtifact,
  run: UltraReviewRun,
): boolean {
  return isUltraReviewRun(run)
    && run.repo === artifact.identity.repo
    && run.prNumber === artifact.identity.prNumber
    && (
      run.status === "starting"
      || run.status === "running"
    );
}

function interruptedStage(
  artifact: UltraReviewArtifact,
): UltraReviewGenerationStage {
  const active =
    artifact.generation.stages.find(
      (stage) => stage.status === "running",
    );
  if (active) {
    return {
      ...active,
      status: "failed",
      error: INTERRUPTION_MESSAGE,
    };
  }
  return {
    id: INTERRUPTION_STAGE_ID,
    label: "UltraReview analysis",
    status: "failed",
    systemId: null,
    error: INTERRUPTION_MESSAGE,
  };
}

function interruptionFailure(
  stageId: string,
): UltraReviewGenerationFailure {
  return {
    id: INTERRUPTION_FAILURE_ID,
    stageId,
    scope: "artifact",
    systemId: null,
    chapterId: null,
    message: INTERRUPTION_MESSAGE,
    retryable: true,
    evidenceIds: [],
  };
}

export function recoverInterruptedUltraReviewArtifact(
  artifact: UltraReviewArtifact,
  runs: readonly UltraReviewRun[],
): UltraReviewArtifact {
  if (
    artifact.generation.status !== "running"
    || runs.some(
      (run) => isActiveUltraReviewRun(artifact, run),
    )
  ) {
    return artifact;
  }

  const failedStage = interruptedStage(artifact);
  const stageExists = artifact.generation.stages.some(
    (stage) => stage.id === failedStage.id,
  );
  const hasPublishedChapter = artifact.galaxy.systems.some(
    (system) => system.chapters.length > 0,
  );

  return {
    ...artifact,
    generation: {
      status: hasPublishedChapter ? "partial" : "failed",
      stages: stageExists
        ? artifact.generation.stages.map((stage) =>
            stage.id === failedStage.id
              ? failedStage
              : stage
          )
        : [
            ...artifact.generation.stages,
            failedStage,
          ],
      failures: [
        ...artifact.generation.failures.filter(
          (failure) => failure.id !== INTERRUPTION_FAILURE_ID,
        ),
        interruptionFailure(failedStage.id),
      ],
    },
  };
}
