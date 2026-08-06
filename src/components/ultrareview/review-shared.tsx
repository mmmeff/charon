import { useState } from "react";
import type {
  DiffViewerViewState,
  LineSelection,
  UltraReviewArtifact,
} from "../../types";

export const EMPTY_DIFF_VIEW_STATE: DiffViewerViewState = {
  collapsed: {},
  expandedContext: {},
};

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
}: {
  label: string;
  onSave: (body: string) => boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
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
      <div className="row">
        <button
          type="button"
          className="primary small"
          disabled={!body.trim()}
          onClick={() =>
            setBody(
              saveNoteComposerBody(body, onSave, onSaved),
            )}
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

export function lineNoteEvidenceId(
  artifact: UltraReviewArtifact,
  selection: LineSelection,
): string | null {
  return artifact.evidence.find((evidence) => {
    const location = evidence.location;
    return (
      evidence.kind === "changed"
      && location.path === selection.path
      && location.side === selection.side
      && location.startLine !== null
      && location.endLine !== null
      && selection.startLine >= location.startLine
      && selection.endLine <= location.endLine
    );
  })?.id ?? null;
}
