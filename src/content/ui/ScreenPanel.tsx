import { useEffect, useState } from 'react';
import { BREAKPOINTS, breakpointOf } from '../../shared/model';
import { resizeViewport } from '../ext';
import { Icon, type IconName } from './icons';
import { PanelHead } from './PanelHead';

const PRESETS: { label: string; width: number; icon: IconName }[] = [
  { label: 'Phone', width: 390, icon: 'phone' },
  { label: 'Tablet', width: 834, icon: 'tablet' },
  { label: 'Laptop', width: 1280, icon: 'desktop' },
  { label: 'Desktop', width: 1440, icon: 'desktop' },
];

/** The width before the first preset, so it can be put back (kept while the tab lives). */
const session: { original: number | null } = { original: null };

/** Resize to a preset width, remembering where it started the first time. */
function resizeTo(target: number): void {
  if (session.original === null) session.original = viewportWidth();
  void resizeViewport(target);
}

function viewportWidth(): number {
  return document.documentElement.clientWidth || window.innerWidth;
}

/**
 * Review at standard widths: the browser window is resized so the page's own breakpoints
 * apply (Chrome may stop short of the narrowest; the readout shows the real width).
 */
export function ScreenPanel() {
  const [width, setWidth] = useState(viewportWidth);
  useEffect(() => {
    const onResize = () => setWidth(viewportWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const go = resizeTo;
  const near = (w: number) => Math.abs(width - w) <= 2;

  return (
    <div className="panel screen-panel">
      <PanelHead title="Screen size" />
      <p className="screen-readout" aria-live="polite">
        <b>{width}</b> px · {BREAKPOINTS[breakpointOf(width)].label}
      </p>
      <div className="tiles">
        {PRESETS.map((p) => {
          const Glyph = Icon[p.icon];
          return (
            <div key={p.label} className="tile-wrap">
              <button
                type="button"
                className="tile"
                data-on={near(p.width) ? '' : undefined}
                aria-pressed={near(p.width)}
                onClick={() => go(p.width)}
              >
                <span className="tile-icon">
                  <Glyph />
                </span>
                <span className="tile-label">
                  {p.label} · {p.width}
                </span>
              </button>
            </div>
          );
        })}
        {session.original !== null && !near(session.original) ? (
          <div className="tile-wrap">
            <button type="button" className="tile" onClick={() => go(session.original ?? width)}>
              <span className="tile-icon">
                <Icon.undo />
              </span>
              <span className="tile-label">Back to {session.original}</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
