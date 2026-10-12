import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import type { GridSettings } from '../../shared/model';
import { useEditor, useEnv } from '../context';
import { capturePointer } from '../dom';

interface ScrubProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  onChange: (value: number) => void;
}

/** Numeric field whose label can be dragged horizontally to scrub the value. */
export function ScrubField({
  label,
  value,
  min = 0,
  max = 9999,
  unit,
  disabled,
  placeholder,
  ariaLabel,
  onChange,
}: ScrubProps) {
  const drag = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const onDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    e.preventDefault();
    capturePointer(e.currentTarget, e.pointerId);
    drag.current = { x: e.clientX, v: value };
  };
  const onMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d) return;
    const step = e.shiftKey ? 10 : 1;
    onChange(clamp(d.v + Math.round((e.clientX - d.x) / 3) * step));
  };
  const onUp = () => {
    drag.current = null;
  };
  return (
    <div className="scrub" data-disabled={disabled ? '' : undefined}>
      <span
        className="scrub-label"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {label}
      </span>
      {disabled ? (
        <span className="scrub-auto">{placeholder ?? 'Auto'}</span>
      ) : (
        <input
          type="number"
          aria-label={label || ariaLabel}
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(clamp(v));
          }}
        />
      )}
      {unit && !disabled ? <span className="scrub-unit">{unit}</span> : null}
    </div>
  );
}

export function GridPanel() {
  const { store } = useEnv();
  const grid = useEditor((s) => s.grid);
  const update = (patch: Partial<GridSettings>) =>
    store.set({ grid: { ...store.getState().grid, ...patch } });
  return (
    <div className="panel grid-panel">
      <div className="panel-head">
        <h2>Columns</h2>
        <span className="muted small">A layout grid over the page</span>
      </div>
      <div
        className="seg"
        role="radiogroup"
        aria-label="Column type"
        style={{ ['--n' as string]: 2, ['--i' as string]: grid.mode === 'stretch' ? 0 : 1 }}
      >
        <span className="seg-loz" aria-hidden="true" />
        {(['stretch', 'fixed'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={grid.mode === mode}
            data-active={grid.mode === mode ? '' : undefined}
            onClick={() => update({ mode })}
          >
            {mode === 'stretch' ? 'Stretch' : 'Fixed width'}
          </button>
        ))}
      </div>
      <div className="grid-fields">
        <ScrubField
          label="Count"
          value={grid.count}
          min={1}
          max={48}
          onChange={(count) => update({ count })}
        />
        <ScrubField
          label="Width"
          value={grid.columnWidth}
          min={1}
          max={600}
          unit="px"
          disabled={grid.mode === 'stretch'}
          onChange={(columnWidth) => update({ columnWidth })}
        />
        <ScrubField
          label="Margin"
          value={grid.margin}
          max={600}
          unit="px"
          disabled={grid.mode === 'fixed'}
          placeholder="Centered"
          onChange={(margin) => update({ margin })}
        />
        <ScrubField
          label="Gutter"
          value={grid.gutter}
          max={200}
          unit="px"
          onChange={(gutter) => update({ gutter })}
        />
      </div>
      <div className="grid-color">
        <label className="color-chip">
          <input
            type="color"
            value={grid.color}
            onChange={(e) => update({ color: e.target.value.toUpperCase() })}
            aria-label="Grid colour"
          />
          <span style={{ background: grid.color }} />
        </label>
        <input
          key={grid.color}
          className="hex"
          defaultValue={grid.color.replace('#', '')}
          aria-label="Grid colour hex"
          maxLength={6}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9a-f]/gi, '');
            if (v.length === 6) update({ color: `#${v.toUpperCase()}` });
          }}
        />
        <ScrubField
          label=""
          value={grid.opacity}
          max={100}
          unit="%"
          onChange={(opacity) => update({ opacity })}
        />
      </div>
    </div>
  );
}
