import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { gridColumns } from '../../shared/measure';
import type { GridSettings, GridSpacing } from '../../shared/model';
import { useEditor, useEnv } from '../context';
import { capturePointer } from '../dom';
import { Icon } from './icons';

const clampTo = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(v)));

/** Keeps a callback's latest closure for listeners and timers that outlive a render. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

interface NumberBoxProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}

/**
 * A number you can type over. Focusing it selects the value and the first key replaces it
 * (even where the selection doesn't stick, as on iOS); deleting leaves it empty instead of
 * snapping back to the minimum, and every valid number applies as you type. Leaving the box
 * empty or below the minimum restores the last good value.
 */
export function NumberBox({ label, value, min, max, unit, onChange }: NumberBoxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const fresh = useRef(false);
  const live = useLatest({ min, max, onChange });

  const apply = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setDraft(digits);
    const { min: lo, max: hi, onChange: set } = live.current;
    if (digits !== '' && Number(digits) >= lo) set(Math.min(hi, Number(digits)));
  };
  const applyRef = useLatest(apply);

  // The slider or −/+ changed the value while the box has focus: show it, ready to type over.
  useEffect(() => {
    setDraft((d) => {
      if (d === null || d === '' || Number(d) === value) return d;
      fresh.current = true;
      return String(value);
    });
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      if (!fresh.current || e.isComposing) return;
      if (e.inputType === 'insertText' || e.inputType.startsWith('delete')) {
        e.preventDefault();
        fresh.current = false;
        applyRef.current(e.inputType === 'insertText' ? (e.data ?? '') : '');
      }
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  }, [applyRef]);

  return (
    <label className="numbox" data-editing={draft !== null ? '' : undefined}>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={label}
        value={draft ?? String(value)}
        onFocus={(e) => {
          fresh.current = true;
          setDraft(String(value));
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => {
          fresh.current = false;
          apply(e.target.value);
        }}
        onBlur={() => {
          fresh.current = false;
          if (draft !== null && draft !== '' && Number(draft) < min) onChange(min);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
            const next = clampTo(value + step, min, max);
            onChange(next);
            setDraft(String(next));
            fresh.current = true;
          }
        }}
      />
      {unit ? <span className="numbox-unit">{unit}</span> : null}
    </label>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/**
 * Touch-friendly slider: drag anywhere along it or tap to jump. A touch only takes over once
 * it moves sideways, so a vertical swipe that starts on the slider still scrolls the sheet.
 */
export function Slider({ label, value, min, max, disabled, onChange }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; id: number; active: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const p = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const valueAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return value;
    const inset = 11; // thumb radius, so both ends are reachable
    const t = (clientX - r.left - inset) / Math.max(1, r.width - inset * 2);
    return clampTo(min + Math.max(0, Math.min(1, t)) * (max - min), min, max);
  };
  const take = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = press.current;
    if (!s) return;
    s.active = true;
    capturePointer(e.currentTarget, e.pointerId);
    setDragging(true);
    onChange(valueAt(e.clientX));
  };

  return (
    <div
      ref={ref}
      className="slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      data-dragging={dragging ? '' : undefined}
      style={{ ['--p' as string]: p }}
      onPointerDown={(e) => {
        if (disabled || e.button > 0) return;
        press.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false };
        if (e.pointerType !== 'touch') {
          e.preventDefault();
          take(e);
        }
      }}
      onPointerMove={(e) => {
        const s = press.current;
        if (!s || s.id !== e.pointerId) return;
        if (s.active) {
          onChange(valueAt(e.clientX));
          return;
        }
        const dx = Math.abs(e.clientX - s.x);
        const dy = Math.abs(e.clientY - s.y);
        if (dx > 6 && dx > dy) take(e);
        else if (dy > 8) press.current = null; // a scroll, not ours
      }}
      onPointerUp={(e) => {
        const s = press.current;
        press.current = null;
        setDragging(false);
        if (s && !s.active && s.id === e.pointerId) onChange(valueAt(e.clientX)); // a tap
      }}
      onPointerCancel={() => {
        press.current = null;
        setDragging(false);
      }}
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (disabled) return;
        const big = Math.max(1, Math.round((max - min) / 10));
        const step: Record<string, number> = {
          ArrowRight: e.shiftKey ? 10 : 1,
          ArrowUp: e.shiftKey ? 10 : 1,
          ArrowLeft: e.shiftKey ? -10 : -1,
          ArrowDown: e.shiftKey ? -10 : -1,
          PageUp: big,
          PageDown: -big,
        };
        if (e.key === 'Home') onChange(min);
        else if (e.key === 'End') onChange(max);
        else if (e.key in step) onChange(clampTo(value + (step[e.key] ?? 0), min, max));
        else return;
        e.preventDefault();
      }}
    >
      <span className="slider-track">
        <span className="slider-fill" />
      </span>
      <span className="slider-thumb" />
    </div>
  );
}

/** −/+ buttons that repeat while held. */
function StepButton({
  dir,
  label,
  onStep,
}: {
  dir: 1 | -1;
  label: string;
  onStep: (d: number) => void;
}) {
  const timer = useRef(0);
  const step = useLatest(onStep);
  const stop = () => {
    window.clearTimeout(timer.current);
    window.clearInterval(timer.current);
  };
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearInterval(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className="step-btn"
      aria-label={label}
      onPointerDown={(e) => {
        if (e.button > 0) return;
        e.preventDefault(); // keep focus (and the keyboard) where it was
        step.current(dir);
        stop();
        timer.current = window.setTimeout(() => {
          timer.current = window.setInterval(() => step.current(dir), 80);
        }, 400);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (e.detail === 0) step.current(dir); // keyboard
      }}
    >
      {dir < 0 ? <Icon.minus /> : <Icon.plus />}
    </button>
  );
}

type Layout = 'stretch' | GridSpacing;

const LAYOUTS: { id: Layout; label: string; name: string; hint: string }[] = [
  {
    id: 'stretch',
    label: 'Stretch',
    name: 'Stretch',
    hint: 'Columns fill the page between the margins.',
  },
  {
    id: 'start',
    label: 'Left',
    name: 'Left',
    hint: 'Fixed-width columns from the left margin.',
  },
  {
    id: 'center',
    label: 'Center',
    name: 'Center',
    hint: 'Fixed-width columns in the middle.',
  },
  {
    id: 'end',
    label: 'Right',
    name: 'Right',
    hint: 'Fixed-width columns up to the right margin.',
  },
  {
    id: 'between',
    label: 'Between',
    name: 'Space between',
    hint: 'Equal gaps; outer columns touch the margins.',
  },
  {
    id: 'around',
    label: 'Around',
    name: 'Space around',
    hint: 'Equal space on both sides of every column.',
  },
  {
    id: 'evenly',
    label: 'Evenly',
    name: 'Space evenly',
    hint: 'Equal gaps everywhere, edges included.',
  },
];

function LayoutPreview({ layout }: { layout: Layout }) {
  const cols =
    layout === 'stretch'
      ? gridColumns(44, { mode: 'stretch', count: 3, columnWidth: 0, margin: 3, gutter: 2.5 })
      : gridColumns(44, {
          mode: 'fixed',
          count: 3,
          columnWidth: 5,
          spacing: layout,
          margin: 3,
          gutter: 1.5,
        });
  return (
    <svg viewBox="0 0 44 24" width="44" height="24" aria-hidden="true">
      <rect x="0.5" y="0.5" width="43" height="23" rx="4.5" className="lp-frame" />
      {cols.map((c) => (
        <rect key={c.x} x={c.x} y="4" width={c.width} height="16" rx="1.2" className="lp-col" />
      ))}
    </svg>
  );
}

/**
 * Switch layout. Fixed-width columns that wouldn't fit the window (the 72px default is far
 * too wide for twelve columns on a phone) are narrowed so the switch still shows every
 * column; spread layouts get a little extra room so their gaps are visible.
 */
export function chooseLayout(grid: GridSettings, layout: Layout, viewportWidth: number) {
  if (layout === 'stretch') return { mode: 'stretch' as const };
  const spread = layout === 'between' || layout === 'around' || layout === 'evenly';
  const room = viewportWidth - grid.margin * 2;
  const gaps = spread ? 0 : (grid.count - 1) * grid.gutter;
  const patch: Partial<GridSettings> = { mode: 'fixed', spacing: layout };
  if (grid.count * grid.columnWidth + gaps > room) {
    const fit = (room - (grid.count - 1) * grid.gutter) / grid.count;
    patch.columnWidth = Math.max(8, Math.floor(spread ? fit * 0.75 : fit));
  }
  return patch;
}

const COUNT_PRESETS = [1, 2, 3, 4, 6, 8, 12];
const GRID_COLORS = ['#008BFF', '#EF4444', '#22C55E', '#A855F7', '#F59E0B', '#111827'];

function SliderRow({
  label,
  value,
  min,
  max,
  inputMax,
  unit,
  off,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  inputMax?: number;
  unit: string;
  /** Shown instead of the number when the setting doesn't apply to this layout. */
  off?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="slider-row" data-off={off ? '' : undefined}>
      <span className="slider-label">{label}</span>
      {off ? (
        <span className="slider-off">{off}</span>
      ) : (
        <NumberBox
          label={label}
          value={value}
          min={min}
          max={inputMax ?? max}
          unit={unit}
          onChange={onChange}
        />
      )}
      <Slider
        label={label}
        value={Math.min(value, max)}
        min={min}
        max={max}
        disabled={!!off}
        onChange={onChange}
      />
    </div>
  );
}

export function GridPanel() {
  const { store } = useEnv();
  const grid = useEditor((s) => s.grid);
  const update = (patch: Partial<GridSettings>) =>
    store.set({ grid: { ...store.getState().grid, ...patch } });
  const layout: Layout = grid.mode === 'stretch' ? 'stretch' : grid.spacing;
  const spread = layout === 'between' || layout === 'around' || layout === 'evenly';
  const preset = COUNT_PRESETS.indexOf(grid.count);
  const layoutIndex = LAYOUTS.findIndex((l) => l.id === layout);

  return (
    <div className="panel grid-panel">
      <div className="panel-head">
        <h2>Columns</h2>
        <button
          type="button"
          className="toggle-row"
          role="switch"
          aria-checked={grid.visible}
          onClick={() => update({ visible: !grid.visible })}
        >
          <span className="muted">Show</span>
          <span className="switch" data-on={grid.visible ? '' : undefined} />
        </button>
      </div>

      <section className="grid-section">
        <div className="count-row">
          <span className="slider-label">How many</span>
          <div className="stepper">
            <StepButton
              dir={-1}
              label="Fewer columns"
              onStep={(d) => update({ count: clampTo(store.getState().grid.count + d, 1, 48) })}
            />
            <NumberBox
              label="Number of columns"
              value={grid.count}
              min={1}
              max={48}
              onChange={(count) => update({ count })}
            />
            <StepButton
              dir={1}
              label="More columns"
              onStep={(d) => update({ count: clampTo(store.getState().grid.count + d, 1, 48) })}
            />
          </div>
        </div>
        <div
          className="seg count-presets"
          role="radiogroup"
          aria-label="Common column counts"
          data-none={preset < 0 ? '' : undefined}
          style={{
            ['--n' as string]: COUNT_PRESETS.length,
            ['--i' as string]: Math.max(0, preset),
          }}
        >
          <span className="seg-loz" aria-hidden="true" />
          {COUNT_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={grid.count === n}
              data-active={grid.count === n ? '' : undefined}
              onClick={() => update({ count: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <section className="grid-section">
        <span className="slider-label">Layout</span>
        <div className="layout-tiles" role="radiogroup" aria-label="Column layout">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              className="layout-tile"
              aria-checked={layout === l.id}
              aria-label={l.name}
              data-active={layout === l.id ? '' : undefined}
              onClick={() => update(chooseLayout(store.getState().grid, l.id, window.innerWidth))}
            >
              <LayoutPreview layout={l.id} />
              <span>{l.label}</span>
            </button>
          ))}
        </div>
        <p className="layout-hint muted small" key={layout}>
          {LAYOUTS[layoutIndex]?.hint}
        </p>
      </section>

      <section className="grid-section sliders">
        <SliderRow
          label="Width"
          value={grid.columnWidth}
          min={8}
          max={480}
          inputMax={2000}
          unit="px"
          off={layout === 'stretch' ? 'Fills the page' : undefined}
          onChange={(columnWidth) => update({ columnWidth })}
        />
        <SliderRow
          label="Gutter"
          value={grid.gutter}
          min={0}
          max={160}
          inputMax={400}
          unit="px"
          off={spread ? 'Spaced automatically' : undefined}
          onChange={(gutter) => update({ gutter })}
        />
        <SliderRow
          label="Margin"
          value={grid.margin}
          min={0}
          max={240}
          inputMax={1000}
          unit="px"
          off={layout === 'center' ? 'Centered' : undefined}
          onChange={(margin) => update({ margin })}
        />
      </section>

      <section className="grid-section">
        <span className="slider-label">Colour</span>
        <div className="swatches" role="radiogroup" aria-label="Column colour">
          {GRID_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              className="swatch"
              aria-checked={grid.color === c}
              aria-label={c}
              data-active={grid.color === c ? '' : undefined}
              style={{ ['--c' as string]: c }}
              onClick={() => update({ color: c })}
            />
          ))}
          <label
            className="swatch custom"
            data-active={GRID_COLORS.includes(grid.color) ? undefined : ''}
            style={{ ['--c' as string]: grid.color }}
          >
            <input
              type="color"
              value={grid.color}
              onChange={(e) => update({ color: e.target.value.toUpperCase() })}
              aria-label="Custom colour"
            />
          </label>
        </div>
        <SliderRow
          label="Opacity"
          value={grid.opacity}
          min={0}
          max={100}
          unit="%"
          onChange={(opacity) => update({ opacity })}
        />
      </section>
    </div>
  );
}
