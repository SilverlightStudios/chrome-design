import type { ReactNode } from 'react';

/** Original 20×20 stroke icon set for the toolbar. */
function Svg({ children, filled = false }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  select: () => (
    <Svg>
      <path d="M4.5 3.5l11 5.2-4.7 1.4-1.6 4.8z" fill="currentColor" />
    </Svg>
  ),
  comment: () => (
    <Svg>
      <path d="M4 15.5V6.8A3.3 3.3 0 0 1 7.3 3.5h5.4A3.3 3.3 0 0 1 16 6.8v2.9a3.3 3.3 0 0 1-3.3 3.3H7.2z" />
      <path d="M7.5 7.8h5M7.5 10h3" />
    </Svg>
  ),
  draw: () => (
    <Svg>
      <path d="M12.6 3.9l3.5 3.5-7.4 7.4-4.2.8.8-4.2z" />
      <path d="M3.5 17.2c2.2-1 3.6.9 5.8-.1" />
    </Svg>
  ),
  rulers: () => (
    <Svg>
      <rect x="2.8" y="7" width="14.4" height="6" rx="1.2" transform="rotate(-35 10 10)" />
      <path d="M7.3 9.4l1 1.4M9.4 8l1 1.4M11.5 6.5l1 1.4" />
    </Svg>
  ),
  grid: () => (
    <Svg>
      <rect x="3.5" y="3.5" width="3" height="13" rx="1" />
      <rect x="8.5" y="3.5" width="3" height="13" rx="1" />
      <rect x="13.5" y="3.5" width="3" height="13" rx="1" />
    </Svg>
  ),
  list: () => (
    <Svg>
      <path d="M8 5.5h8.5M8 10h8.5M8 14.5h8.5" />
      <circle cx="4.3" cy="5.5" r="1" fill="currentColor" />
      <circle cx="4.3" cy="10" r="1" fill="currentColor" />
      <circle cx="4.3" cy="14.5" r="1" fill="currentColor" />
    </Svg>
  ),
  export: () => (
    <Svg>
      <path d="M10 3.5v8.2M6.6 8.5L10 11.9l3.4-3.4" />
      <path d="M3.8 12.5v1.8a2 2 0 0 0 2 2h8.4a2 2 0 0 0 2-2v-1.8" />
    </Svg>
  ),
  help: () => (
    <Svg>
      <circle cx="10" cy="10" r="6.7" />
      <path d="M8.2 8.1a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4" />
      <circle cx="10" cy="13.7" r=".4" fill="currentColor" />
    </Svg>
  ),
  close: () => (
    <Svg>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </Svg>
  ),
  grip: () => (
    <Svg filled>
      <circle cx="8" cy="5.5" r="1.2" />
      <circle cx="12" cy="5.5" r="1.2" />
      <circle cx="8" cy="10" r="1.2" />
      <circle cx="12" cy="10" r="1.2" />
      <circle cx="8" cy="14.5" r="1.2" />
      <circle cx="12" cy="14.5" r="1.2" />
    </Svg>
  ),
  pen: () => (
    <Svg>
      <path d="M3.5 14.5c2-4.5 4-8.5 6-8.5s.5 7 2.5 7 2.5-4 4.5-5" />
    </Svg>
  ),
  line: () => (
    <Svg>
      <path d="M4.5 15.5l11-11" />
    </Svg>
  ),
  arrow: () => (
    <Svg>
      <path d="M4.5 15.5l11-11M8.5 4.5h7v7" />
    </Svg>
  ),
  rect: () => (
    <Svg>
      <rect x="3.8" y="4.8" width="12.4" height="10.4" rx="1.4" />
    </Svg>
  ),
  ellipse: () => (
    <Svg>
      <ellipse cx="10" cy="10" rx="6.5" ry="5.3" />
    </Svg>
  ),
  text: () => (
    <Svg>
      <path d="M4.5 5.5V4h11v1.5M10 4v12M7.8 16h4.4" />
    </Svg>
  ),
  eraser: () => (
    <Svg>
      <path d="M8.2 16h7.3M3.9 11.9l6.8-6.8a1.6 1.6 0 0 1 2.3 0l2.4 2.4a1.6 1.6 0 0 1 0 2.3L10 15.2H7.2z" />
      <path d="M7.5 8.4l4.6 4.6" />
    </Svg>
  ),
  undo: () => (
    <Svg>
      <path d="M7.5 5L4 8.5 7.5 12" />
      <path d="M4.5 8.5h7a4 4 0 0 1 0 8H9" />
    </Svg>
  ),
  redo: () => (
    <Svg>
      <path d="M12.5 5L16 8.5 12.5 12" />
      <path d="M15.5 8.5h-7a4 4 0 0 0 0 8H11" />
    </Svg>
  ),
  trash: () => (
    <Svg>
      <path d="M4 6h12M8 6V4.5h4V6M5.5 6l.8 9.6a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4L14.5 6" />
    </Svg>
  ),
  check: () => (
    <Svg>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </Svg>
  ),
  reopen: () => (
    <Svg>
      <path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 4v3.5H12" />
    </Svg>
  ),
  parent: () => (
    <Svg>
      <path d="M10 15.5v-11M5.5 9L10 4.5 14.5 9" />
    </Svg>
  ),
  copy: () => (
    <Svg>
      <rect x="7" y="7" width="9" height="9" rx="1.6" />
      <path d="M13 7V5.6A1.6 1.6 0 0 0 11.4 4H5.6A1.6 1.6 0 0 0 4 5.6v5.8A1.6 1.6 0 0 0 5.6 13H7" />
    </Svg>
  ),
  dash: () => (
    <Svg>
      <path d="M3.5 10h2.5M8.8 10h2.5M14 10h2.5" />
    </Svg>
  ),
};

export type IconName = keyof typeof Icon;
