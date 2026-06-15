import type { PrReviewFilter, PrReviewFilters } from "../types";
import {
  makeReviewFilter,
  REVIEW_FILTER_QUALIFIERS,
  REVIEW_STATUS_VALUES,
  reviewFiltersToQuery,
} from "../lib/pr-review-filters";

export function PrReviewFilterBuilder({
  filters,
  onChange,
}: {
  filters: PrReviewFilters;
  onChange: (filters: PrReviewFilters) => void;
}) {
  const rows = filters.filters;
  const patchRow = (id: string, patch: Partial<PrReviewFilter>) => {
    onChange({
      filters: rows.map((row) => {
        if (row.id !== id) return row;
        const nextQualifier = patch.qualifier ?? row.qualifier;
        const nextValue =
          patch.value ??
          (nextQualifier === row.qualifier
            ? row.value
            : nextQualifier === "review"
              ? "none"
              : "@me");
        return { ...row, ...patch, value: nextValue };
      }),
    });
  };
  const addRow = (qualifier: PrReviewFilter["qualifier"] = "review-requested", value = "@me") =>
    onChange({ filters: [...rows, makeReviewFilter(qualifier, value)] });
  const removeRow = (id: string) => onChange({ filters: rows.filter((row) => row.id !== id) });
  const setReviewRequestedMe = () =>
    onChange({ filters: [makeReviewFilter("review-requested", "@me")] });
  const query = reviewFiltersToQuery(filters);

  return (
    <div className="review-filter-builder">
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="small" onClick={() => addRow()}>
          Add filter
        </button>
        <button className="small" onClick={setReviewRequestedMe}>
          Review request: me
        </button>
        {rows.length > 0 && (
          <button className="link small" onClick={() => onChange({ filters: [] })}>
            clear
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="subtle review-filter-empty">No review filters.</p>
      ) : (
        <>
          <div className="review-filter-list">
            {rows.map((row) => {
              const meta = REVIEW_FILTER_QUALIFIERS.find((q) => q.value === row.qualifier);
              return (
                <div key={row.id} className="review-filter-row">
                  <select
                    value={row.qualifier}
                    onChange={(e) =>
                      patchRow(row.id, { qualifier: e.target.value as PrReviewFilter["qualifier"] })
                    }
                    title="Filter qualifier"
                  >
                    {REVIEW_FILTER_QUALIFIERS.map((q) => (
                      <option key={q.value} value={q.value}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                  {row.qualifier === "review" ? (
                    <select
                      value={row.value}
                      onChange={(e) => patchRow(row.id, { value: e.target.value })}
                      title="Review status"
                    >
                      {REVIEW_STATUS_VALUES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={row.value}
                      placeholder={meta?.placeholder}
                      onChange={(e) => patchRow(row.id, { value: e.target.value })}
                    />
                  )}
                  <button className="link small" onClick={() => removeRow(row.id)}>
                    remove
                  </button>
                </div>
              );
            })}
          </div>
          <div className="review-filter-query">
            <span>GitHub</span>
            <code>{query}</code>
          </div>
        </>
      )}
    </div>
  );
}
