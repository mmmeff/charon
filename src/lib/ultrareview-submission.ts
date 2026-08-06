import type {
  ProposedInlineComment,
  UltraReviewSubmissionOutcome,
  UltraReviewSubmissionSnapshot,
} from "../types";

type UltraReviewVerdict =
  | "COMMENT"
  | "APPROVE"
  | "REQUEST_CHANGES";

interface UltraReviewDraftSection {
  id: string;
  body: string;
  sourceNoteIds: string[];
}

interface UltraReviewSubmissionDraft {
  body: string;
  sections: UltraReviewDraftSection[];
  comments: ProposedInlineComment[];
}

interface BuildUltraReviewSubmissionInput {
  draft: UltraReviewSubmissionDraft;
  verdict: UltraReviewVerdict;
  knownNoteIds: ReadonlySet<string>;
  missingCoverageIds: string[];
  incompleteAcknowledged: boolean;
}

interface UltraReviewSubmission {
  body: string;
  event: UltraReviewVerdict;
  comments: ProposedInlineComment[];
}

interface SubmitUltraReviewWithReceiptInput {
  snapshot: UltraReviewSubmissionSnapshot;
  submit: () => Promise<string>;
  persist: (
    snapshot: UltraReviewSubmissionSnapshot,
  ) => Promise<void>;
}

function assertKnownProvenance(
  draft: UltraReviewSubmissionDraft,
  knownNoteIds: ReadonlySet<string>,
): void {
  for (const section of draft.sections) {
    for (const noteId of section.sourceNoteIds) {
      if (!knownNoteIds.has(noteId)) {
        throw new Error(
          `UltraReview draft section ${section.id} cites unknown note ${noteId}`,
        );
      }
    }
  }
}

export function buildUltraReviewSubmission(
  input: BuildUltraReviewSubmissionInput,
): UltraReviewSubmission {
  assertKnownProvenance(input.draft, input.knownNoteIds);

  if (
    input.missingCoverageIds.length > 0
    && !input.incompleteAcknowledged
  ) {
    throw new Error(
      `UltraReview is incomplete: ${input.missingCoverageIds.join(", ")}`,
    );
  }

  return {
    body: input.draft.body,
    event: input.verdict,
    comments: input.draft.comments,
  };
}

export async function submitUltraReviewWithReceipt(
  input: SubmitUltraReviewWithReceiptInput,
): Promise<UltraReviewSubmissionOutcome> {
  const url = await input.submit();
  try {
    await input.persist(input.snapshot);
    return {
      status: "persisted",
      url,
    };
  } catch (error) {
    return {
      status: "persistence_failed",
      url,
      snapshot: input.snapshot,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
