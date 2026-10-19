import { useEffect, useState, useSyncExternalStore } from 'react';
import { pointsToPath } from '../../shared/geometry';
import { LASER_MS } from '../../walkthrough/model';
import { recorder } from '../walkthrough/recorder';

/**
 * What the reviewer sees while a walkthrough records: a red edge, the laser's fading trail,
 * red ink (fading 1.5 s after the pen lifts), numbered pins and a ring at each click. Drawn in
 * page space (an SVG with no size, overflowing from the document's top left) so it scrolls with
 * the page. The surface only takes the pointer while ⇧ is held or Draw is on.
 */
export function WalkthroughLayer() {
  const s = useSyncExternalStore(recorder.subscribe, recorder.getState);
  const [now, setNow] = useState(() => Date.now());
  const laserOn = s.laser.length > 0;

  // The laser fades by age, so it redraws every frame while there's a trail.
  useEffect(() => {
    if (!laserOn) return;
    let frame = requestAnimationFrame(function tick() {
      setNow(Date.now());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [laserOn]);

  const recording = s.phase === 'recording';
  if (!recording && s.ink.length === 0 && s.pins.length === 0) return null;
  const capturing = recording && (s.shift || s.drawing);
  const trail = s.laser.filter((p) => now - p[2] <= LASER_MS);

  return (
    <>
      <div className="rec-edge" data-on={recording ? '' : undefined} aria-hidden="true" />
      <div
        className="wt-surface"
        data-wt-surface=""
        data-on={capturing ? '' : undefined}
        data-touch={s.drawing ? '' : undefined}
        aria-hidden="true"
        onContextMenu={(e) => capturing && e.preventDefault()}
      />
      <svg className="wt-ink" width="1" height="1" aria-hidden="true">
        {s.ink.map((stroke) => (
          <path
            key={stroke.id}
            d={pointsToPath(stroke.points)}
            className="wt-stroke"
            data-fading={stroke.fading ? '' : undefined}
          />
        ))}
        {trail.length > 1
          ? trail.slice(1).map((p, i) => {
              const q = trail[i]!;
              const life = Math.max(0, 1 - (now - p[2]) / LASER_MS);
              return (
                <g key={`${p[2]}:${p[0]}:${p[1]}`}>
                  <line
                    x1={q[0]}
                    y1={q[1]}
                    x2={p[0]}
                    y2={p[1]}
                    className="wt-laser-glow"
                    strokeOpacity={0.3 * life}
                    strokeWidth={4 + 6 * life}
                  />
                  <line
                    x1={q[0]}
                    y1={q[1]}
                    x2={p[0]}
                    y2={p[1]}
                    className="wt-laser"
                    strokeOpacity={life}
                    strokeWidth={1.2 + 1.6 * life}
                  />
                </g>
              );
            })
          : null}
        {trail.length > 0 && s.shift ? (
          <g className="wt-laser-tip">
            <circle cx={trail.at(-1)![0]} cy={trail.at(-1)![1]} r="6" className="halo" />
            <circle cx={trail.at(-1)![0]} cy={trail.at(-1)![1]} r="2.6" className="core" />
          </g>
        ) : null}
        {s.ripples.map((r) => (
          <circle key={r.id} cx={r.x} cy={r.y} r="16" className="wt-ripple" />
        ))}
        {s.pins.map((pin) => (
          <g key={pin.n} className="wt-pin" transform={`translate(${pin.x} ${pin.y})`}>
            <circle r="15.5" className="ring" />
            <circle r="13" className="dot" />
            <text y="5.5" textAnchor="middle">
              {pin.n}
            </text>
          </g>
        ))}
      </svg>
    </>
  );
}
