/** 16×16 stroke icons for the nav rail — single-weight, square-cornered. */

const base = {
  width: 17,
  height: 17,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
} as const;

export const IconDrafts = () => (
  <svg {...base}>
    <path d="M2.5 13.5v-2.6l7.6-7.6 2.6 2.6-7.6 7.6H2.5z" />
    <path d="M8.6 4.8l2.6 2.6" />
  </svg>
);

export const IconOpen = () => (
  <svg {...base}>
    <path d="M1.5 8s2.4-4.3 6.5-4.3S14.5 8 14.5 8 12.1 12.3 8 12.3 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2.1" />
  </svg>
);

export const IconReview = () => (
  <svg {...base}>
    <path d="M2 2.5h12v8.5H9.2L6 14v-3H2z" />
    <path d="M5.2 6.8l1.8 1.8 3.6-3.6" />
  </svg>
);

export const IconActivity = () => (
  <svg {...base}>
    <path d="M1 9h3l2-5.5 3.5 9L11.5 7l1 2H15" />
  </svg>
);

export const IconSettings = () => (
  <svg {...base}>
    <path d="M2 4.5h12M2 8h12M2 11.5h12" />
    <circle cx="10.5" cy="4.5" r="1.7" fill="var(--bg-inset)" />
    <circle cx="5" cy="8" r="1.7" fill="var(--bg-inset)" />
    <circle cx="11.5" cy="11.5" r="1.7" fill="var(--bg-inset)" />
  </svg>
);

export const IconRepos = () => (
  <svg {...base}>
    <rect x="2" y="2" width="5" height="5" />
    <rect x="9" y="2" width="5" height="5" />
    <rect x="2" y="9" width="5" height="5" />
    <rect x="9" y="9" width="5" height="5" />
  </svg>
);

export const IconExpand = () => (
  <svg {...base}>
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9" />
  </svg>
);

export const IconRefresh = () => (
  <svg {...base}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" />
    <path d="M13.5 1.5v3h-3" />
  </svg>
);

export const IconSidePanel = () => (
  <svg {...base}>
    <rect x="1.5" y="2.5" width="13" height="11" />
    <path d="M10.5 2.5v11" />
  </svg>
);

/** AI "spark" — opens the agent controls (ask / edit / review). */
export const IconAgent = () => (
  <svg {...base}>
    <path d="M6.4 4C6.7 7.1 7.7 8.3 11 8.6 7.9 8.9 6.7 9.9 6.4 13.2 6.1 10.1 5.1 8.9 1.8 8.6 4.9 8.3 6.1 7.3 6.4 4Z" />
    <path d="M12.2 1.2C12.4 2.9 13 3.6 14.8 3.8 13.1 4 12.4 4.6 12.2 6.4 12 4.7 11.4 4 9.6 3.8 11.3 3.6 12 3 12.2 1.2Z" />
  </svg>
);

/** Brand mark: the moon Charon — bone-gray disk, dusty red polar cap,
 *  equatorial chasm. Filled (not stroked) since it's a mark, not a glyph.
 *  `id` must be unique per render site: clip-path ids are document-global. */
export const IconCharonMoon = ({ size = 20, id = "moon" }: { size?: number; id?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Charon">
    <defs>
      <clipPath id={`charon-${id}`}>
        <circle cx="12" cy="12" r="10" />
      </clipPath>
    </defs>
    <circle cx="12" cy="12" r="10" fill="#cfc9ba" />
    <g clipPath={`url(#charon-${id})`}>
      <ellipse cx="13" cy="3.6" rx="9.6" ry="5.8" fill="#9c4a22" />
      <path d="M2 12.6 q5 -1.8 10 0 t10 -0.6" fill="none" stroke="#5d5749" strokeWidth="1.1" opacity="0.6" />
      <circle cx="8.2" cy="17.2" r="1.5" fill="#5d5749" opacity="0.35" />
      <circle cx="15.8" cy="16" r="1" fill="#5d5749" opacity="0.3" />
    </g>
    <circle cx="12" cy="12" r="10" fill="none" stroke="#0e0d0a" strokeWidth="1.5" opacity="0.5" />
  </svg>
);
