import type { ReactNode } from 'react';

/*
 * Animated icons. Geometry is Lucide (ISC, lucide.dev); the motion follows Lucide Animated
 * (MIT, pqoqubbw/icons — the "animated icons" reference in Spark's resources), ported from its
 * motion/react variants to CSS keyframes in styles.css (`.ai-*`), so there's no animation
 * library in the content script. Icons Lucide Animated doesn't have (pencil, ruler, columns,
 * list, shapes, text, eraser, ellipsis, info) get motion in the same spirit.
 *
 * Playing: `iconMotion.ts` sets `data-play` on the icon when its button is pressed, and when a
 * mouse enters it. Icons marked `hold` instead keep a pose while hovered (CSS) and play on press.
 */
function Svg({
  name,
  hold = false,
  children,
}: {
  name: string;
  hold?: boolean;
  children: ReactNode;
}) {
  return (
    <svg
      className={`ai ai-${name}`}
      data-hold={hold ? '' : undefined}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  // Lucide mouse-pointer-2, moved like Lucide Animated's cursor-click.
  select: () => (
    <Svg name="select">
      <path
        className="p"
        d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
      />
    </Svg>
  ),
  // Lucide Animated message-circle: a wobble.
  comment: () => (
    <Svg name="comment">
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
    </Svg>
  ),
  // Lucide pencil, scribbling like Lucide Animated's square-pen.
  draw: () => (
    <Svg name="draw">
      <g className="p">
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
        <path d="m15 5 4 4" />
      </g>
    </Svg>
  ),
  rulers: () => (
    <Svg name="rulers">
      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
      <path className="t t1" pathLength={1} d="m8.5 6.5 2-2" />
      <path className="t t2" pathLength={1} d="m11.5 9.5 2-2" />
      <path className="t t3" pathLength={1} d="m14.5 12.5 2-2" />
      <path className="t t4" pathLength={1} d="m17.5 15.5 2-2" />
    </Svg>
  ),
  // Lucide columns-3: the dividers slide apart and back.
  grid: () => (
    <Svg name="grid">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path className="c1" d="M9 3v18" />
      <path className="c2" d="M15 3v18" />
    </Svg>
  ),
  list: () => (
    <Svg name="list">
      <path d="M3 5h.01" />
      <path d="M3 12h.01" />
      <path d="M3 19h.01" />
      <path className="l l1" d="M8 5h13" />
      <path className="l l2" d="M8 12h13" />
      <path className="l l3" d="M8 19h13" />
    </Svg>
  ),
  // Lucide Animated download: the arrow drops (held while hovered).
  export: () => (
    <Svg name="export" hold>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <g className="a">
        <path d="m7 10 5 5 5-5" />
        <path d="M12 15V3" />
      </g>
    </Svg>
  ),
  // Lucide Animated circle-help: the question mark shakes.
  help: () => (
    <Svg name="help">
      <circle cx="12" cy="12" r="10" />
      <g className="q">
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </g>
    </Svg>
  ),
  // Lucide Animated x: both strokes draw in.
  close: () => (
    <Svg name="close">
      <path className="s s1" pathLength={1} d="M18 6 6 18" />
      <path className="s s2" pathLength={1} d="m6 6 12 12" />
    </Svg>
  ),
  line: () => (
    <Svg name="line">
      <path className="s" pathLength={1} d="M5 19 19 5" />
    </Svg>
  ),
  // Lucide Animated arrow-up-right: pulls back toward its tip and springs out.
  arrow: () => (
    <Svg name="arrow">
      <g className="a">
        <path d="M7 7h10v10" />
        <path d="M7 17 17 7" />
      </g>
    </Svg>
  ),
  rect: () => (
    <Svg name="rect">
      <rect className="p" width="18" height="18" x="3" y="3" rx="2" />
    </Svg>
  ),
  ellipse: () => (
    <Svg name="ellipse">
      <circle className="p" cx="12" cy="12" r="10" />
    </Svg>
  ),
  text: () => (
    <Svg name="text">
      <path className="bar" d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
      <path className="stem" d="M12 4v16" />
      <path d="M9 20h6" />
    </Svg>
  ),
  // Lucide monitor-smartphone / smartphone / tablet / monitor: screen sizes. They nod.
  sizes: () => (
    <Svg name="device">
      <g className="p">
        <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
        <path d="M10 19v-3.96 3.15" />
        <path d="M7 19h5" />
        <rect width="6" height="10" x="16" y="12" rx="2" />
      </g>
    </Svg>
  ),
  phone: () => (
    <Svg name="device">
      <g className="p">
        <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
        <path d="M12 18h.01" />
      </g>
    </Svg>
  ),
  tablet: () => (
    <Svg name="device">
      <g className="p">
        <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
        <path d="M12 18h.01" />
      </g>
    </Svg>
  ),
  desktop: () => (
    <Svg name="device">
      <g className="p">
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </g>
    </Svg>
  ),
  // Lucide eye-off: the slash draws across.
  eyeOff: () => (
    <Svg name="eye-off">
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path className="s" pathLength={1} d="m2 2 20 20" />
    </Svg>
  ),
  // Lucide copy: the front sheet slides off the back one.
  copy: () => (
    <Svg name="copy">
      <rect className="front" width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Svg>
  ),
  // Lucide folder-open: the folder hops.
  folder: () => (
    <Svg name="folder">
      <path
        className="p"
        d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
      />
    </Svg>
  ),
  // Lucide image: the sun pops while the hills rise.
  image: () => (
    <Svg name="image">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle className="sun" cx="9" cy="9" r="2" />
      <path className="hill" d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </Svg>
  ),
  eraser: () => (
    <Svg name="eraser">
      <g className="p">
        <path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" />
        <path d="m5.082 11.09 8.828 8.828" />
      </g>
    </Svg>
  ),
  // Lucide Animated undo/redo: the head kicks back while the arc pulls in.
  undo: () => (
    <Svg name="undo">
      <path className="h" d="M3 7v6h6" />
      <path className="arc" pathLength={1} d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </Svg>
  ),
  redo: () => (
    <Svg name="redo">
      <path className="h" d="M21 7v6h-6" />
      <path className="arc" pathLength={1} d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </Svg>
  ),
  // Lucide Animated delete (trash-2): the lid lifts (held while hovered).
  trash: () => (
    <Svg name="trash" hold>
      <g className="lid">
        <path d="M3 6h18" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      </g>
      <g className="can">
        <path d="M19 8v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V8" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </g>
    </Svg>
  ),
  // Lucide Animated check: draws in.
  check: () => (
    <Svg name="check">
      <path className="s" pathLength={1} d="M4 12 9 17L20 6" />
    </Svg>
  ),
  // Lucide Animated arrow-up: the head bobs while the stem shortens.
  parent: () => (
    <Svg name="up">
      <path className="h" d="m5 12 7-7 7 7" />
      <path className="stem" d="M12 19V5" />
    </Svg>
  ),
  send: () => (
    <Svg name="up">
      <path className="h" d="m5 12 7-7 7 7" />
      <path className="stem" d="M12 19V5" />
    </Svg>
  ),
  more: () => (
    <Svg name="more">
      <circle className="d d1" cx="5" cy="12" r="1" />
      <circle className="d d2" cx="12" cy="12" r="1" />
      <circle className="d d3" cx="19" cy="12" r="1" />
    </Svg>
  ),
  // Lucide Animated hand: a wave from the wrist.
  hand: () => (
    <Svg name="hand">
      <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
      <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </Svg>
  ),
  info: () => (
    <Svg name="info">
      <circle cx="12" cy="12" r="10" />
      <g className="i">
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </g>
    </Svg>
  ),
  // Lucide Animated settings: a half turn (held while hovered).
  gear: () => (
    <Svg name="gear" hold>
      <g className="p">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </g>
    </Svg>
  ),
  // Lucide Animated chevron-down: a nudge in the direction it points.
  chevron: () => (
    <Svg name="chevron">
      <path className="p" d="m6 9 6 6 6-6" />
    </Svg>
  ),
};

export type IconName = keyof typeof Icon;
