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
