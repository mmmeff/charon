import { useId } from "react";
import type { UltraReviewGenerationStatus } from "../../types";

export type UltraReviewEntryProps = {
  generationStatus?: UltraReviewGenerationStatus | null;
  onBegin: () => void;
};

const STATUS_LABELS: Record<
  UltraReviewGenerationStatus,
  string
> = {
  idle: "Waiting",
  running: "Building",
  partial: "Partial",
  complete: "Ready",
  failed: "Failed",
};

export function UltraReviewEntry({
  generationStatus = null,
  onBegin,
}: UltraReviewEntryProps) {
  const newBadgeId = useId();
  const entryStatus = generationStatus ?? "new";
  const statusLabel = generationStatus === null
    ? "New"
    : STATUS_LABELS[generationStatus];

  return (
    <button
      type="button"
      className="ultra-entry-banner"
      data-generation-status={entryStatus}
      aria-label="Open UltraReview"
      aria-describedby={newBadgeId}
      onClick={onBegin}
    >
      <span className="ultra-entry-banner-identity">
        <span className="ultra-entry-banner-title">
          UltraReview
        </span>
        <span
          id={newBadgeId}
          className="ultra-entry-banner-badge"
          aria-live="polite"
          aria-atomic="true"
        >
          {statusLabel}
        </span>
      </span>
      <span className="ultra-entry-banner-signal" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path d="M4 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}
