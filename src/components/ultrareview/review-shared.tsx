import { useState } from "react";
import type {
  CommentInfo,
  DiffViewerViewState,
  LineSelection,
  UltraReviewArtifact,
  UltraReviewNoteKind,
} from "../../types";
import { Markdown } from "../Markdown";

export const EMPTY_DIFF_VIEW_STATE: DiffViewerViewState = {
  collapsed: {},
  expandedContext: {},
};

export const ULTRA_REVIEW_NOTE_KIND_OPTIONS = [
  ["note", "Note"],
  ["nitpick", "Nitpick"],
  ["request", "Request"],
  ["suggestion", "Suggestion"],
  ["praise", "Praise"],
] as const satisfies ReadonlyArray<
  readonly [UltraReviewNoteKind, string]
>;

export function GitHubCommentBody({
  comment,
  className,
}: {
  comment: Pick<CommentInfo, "body" | "bodyHtml">;
  className?: string;
}) {
  return (
    <Markdown
      text={comment.body}
      html={comment.bodyHtml}
      className={["compact", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export function saveNoteComposerBody(
  body: string,
  onSave: (body: string) => boolean,
  onSaved?: () => void,
): string {
  if (!onSave(body.trim())) return body;
  onSaved?.();
  return "";
}

export function NoteComposer({
  label,
  onSave,
  onSaved,
  onCancel,
  error,
}: {
  label: string;
  onSave: (
    body: string,
    kind: UltraReviewNoteKind,
  ) => boolean;
  onSaved?: () => void;
  onCancel?: () => void;
  error?: string;
}) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<UltraReviewNoteKind>("note");
  return (
    <div className="ultra-note-composer">
      <label>
        <span>{label}</span>
        <textarea
          className="input-prose"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write what you observed. This stays local until closing."
        />
      </label>
      <label className="ultra-note-kind">
        <span>Type</span>
        <select
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as UltraReviewNoteKind)
          }
        >
          {ULTRA_REVIEW_NOTE_KIND_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {error && (
        <p className="ultra-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="primary small"
          disabled={!body.trim()}
          onClick={() => {
            const nextBody = saveNoteComposerBody(
              body,
              (trimmed) => onSave(trimmed, kind),
              onSaved,
            );
            setBody(nextBody);
            if (nextBody === "") setKind("note");
          }}
        >
          Add to ledger
        </button>
        {onCancel && (
          <button
            type="button"
            className="small"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function lineNoteEvidenceIds(
  artifact: UltraReviewArtifact,
  selection: LineSelection,
): string[] | null {
  const evidence = artifact.evidence
    .filter((item) => {
      const location = item.location;
      return (
        item.kind === "changed"
        && location.path === selection.path
        && location.side === selection.side
        && location.startLine !== null
        && location.endLine !== null
        && location.endLine >= selection.startLine
        && location.startLine <= selection.endLine
      );
    })
    .sort((left, right) =>
      left.location.startLine! - right.location.startLine!
    );
  let nextLine = selection.startLine;
  const evidenceIds: string[] = [];
  for (const item of evidence) {
    const startLine = item.location.startLine!;
    const endLine = item.location.endLine!;
    if (startLine > nextLine) return null;
    evidenceIds.push(item.id);
    nextLine = Math.max(nextLine, endLine + 1);
    if (nextLine > selection.endLine) return evidenceIds;
  }
  return null;
}
