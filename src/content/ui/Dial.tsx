import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { capturePointer } from '../dom';

// DialKit's slider feel (joshpuckett/dialkit, as used in Spark): the whole row is the slider,
// a tap snaps to the nearest step (or tenth on long ranges), a drag follows the finger, and
// dragging past either end stretches the bar a little.
const CLICK_THRESHOLD = 3;
const DEAD_ZONE = 32;
const MAX_CURSOR_RANGE = 200;
const MAX_STRETCH = 8;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** How far past an end the bar stretches: nothing for the first 32px, then up to 8px. */
function stretchFor(clientX: number, rect: DOMRect) {
  const past = clientX < rect.left ? rect.left - clientX : clientX - rect.right;
  if (clientX >= rect.left && clientX <= rect.right) return 0;
  const t = Math.min(Math.max(0, past - DEAD_ZONE) / MAX_CURSOR_RANGE, 1);
  return (clientX < rect.left ? -1 : 1) * MAX_STRETCH * Math.sqrt(t);
}

/** Keeps a value's latest version for native listeners that outlive a render. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

interface DialProps {
  label: string;
  value: number;
  min: number;
  /** End of the slider. Typed numbers (and arrow keys) may go past it, up to `limit`. */
  max: number;
  limit?: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

export function Dial({
  label,
  value,
  min,
  max,
  limit = 9999,
  step = 1,
  unit,
  onChange,
}: DialProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const press = useRef<{
    x: number;
    y: number;
    id: number;
    touch: boolean;
    dragging: boolean;
    rect: DOMRect;
  } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'press' | 'drag'>('idle');
  const [stretch, setStretch] = useState(0);
  const [editing, setEditing] = useState(false);
  const [dodge, setDodge] = useState(false);
  const steps = Math.round((max - min) / step);
  const p = clamp01((value - min) / (max - min));

  const snap = (v: number, hi: number) =>
    Math.max(min, Math.min(hi, min + Math.round((v - min) / step) * step));
  const quantize = (v: number) => snap(v, max);
  const typed = (v: number) => snap(v, limit);
  const valueAt = (clientX: number, rect: DOMRect) =>
    min + clamp01((clientX - rect.left) / rect.width) * (max - min);
  // Short ranges snap to every step; long ones to the nearest tenth when the tap is close to one.
  const tapValue = (raw: number) => {
    if (steps <= 24) return quantize(raw);
    const t = (raw - min) / (max - min);
    const tenth = Math.round(t * 10) / 10;
    return quantize(Math.abs(t - tenth) <= 1 / 32 ? min + tenth * (max - min) : raw);
  };

  // The handle fades when it would sit on top of the label or the number.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !labelRef.current) return;
    const w = bar.offsetWidth;
    const x = p * w;
    const left = 12 + labelRef.current.offsetWidth + 8;
    const right = w - 12 - (valueRef.current?.offsetWidth ?? 40) - 8;
    setDodge(x < left || x > right);
  }, [p]);

  const end = () => {
    press.current = null;
    setPhase('idle');
    setStretch(0);
  };

  return (
    <div className="dial-wrap">
      <div
        ref={barRef}
        className="dial"
        role="slider"
        tabIndex={editing ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={Math.max(max, value)}
        aria-valuenow={value}
        aria-valuetext={`${value}${unit ? ` ${unit}` : ''}`}
        data-phase={phase}
        data-dodge={dodge ? '' : undefined}
        style={{
          ['--p' as string]: p,
          ['--stretch' as string]: `${Math.abs(stretch)}px`,
          ['--shift' as string]: `${Math.min(0, stretch)}px`,
        }}
        onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
          if (editing || e.button > 0) return;
          const touch = e.pointerType === 'touch';
          press.current = {
            x: e.clientX,
            y: e.clientY,
            id: e.pointerId,
            touch,
            dragging: false,
            rect: e.currentTarget.getBoundingClientRect(),
          };
          setPhase('press');
          // A touch might be the start of a scroll; only claim it once it moves sideways.
          if (!touch) {
            e.preventDefault();
            capturePointer(e.currentTarget, e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          const s = press.current;
          if (!s || s.id !== e.pointerId) return;
          if (!s.dragging) {
            const dx = Math.abs(e.clientX - s.x);
            const dy = Math.abs(e.clientY - s.y);
            if (s.touch) {
              if (dy > 8 && dy > dx) return end(); // the sheet scrolls instead
              if (dx <= 6) return;
              capturePointer(e.currentTarget, e.pointerId);
            } else if (Math.hypot(dx, dy) <= CLICK_THRESHOLD) {
              return;
            }
            s.dragging = true;
            setPhase('drag');
          }
          setStretch(stretchFor(e.clientX, s.rect));
          onChange(quantize(valueAt(e.clientX, s.rect)));
        }}
        onPointerUp={(e) => {
          const s = press.current;
          if (s && !s.dragging && s.id === e.pointerId)
            onChange(tapValue(valueAt(e.clientX, s.rect)));
          end();
        }}
        onPointerCancel={end}
        onKeyDown={(e: ReactKeyboardEvent) => {
          const big = e.shiftKey ? 10 : 1;
          const delta: Record<string, number> = {
            ArrowRight: step * big,
            ArrowUp: step * big,
            ArrowLeft: -step * big,
            ArrowDown: -step * big,
          };
          if (e.key === 'Enter') setEditing(true);
          else if (e.key === 'Home') onChange(min);
          else if (e.key === 'End') onChange(max);
          else if (e.key in delta) onChange(typed(value + (delta[e.key] ?? 0)));
          else return;
          e.preventDefault();
        }}
      >
        <span className="dial-ticks" aria-hidden="true">
          {Array.from({ length: steps <= 10 ? steps - 1 : 9 }, (_, i) => (
            <i
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed tick positions
              key={i}
              style={{ left: `${((i + 1) / (steps <= 10 ? steps : 10)) * 100}%` }}
            />
          ))}
        </span>
        <span className="dial-fill" aria-hidden="true" />
        <span className="dial-handle" aria-hidden="true" />
        <span ref={labelRef} className="dial-label">
          {label}
        </span>
        {editing ? (
          <DialInput
            label={label}
            value={value}
            min={min}
            limit={limit}
            quantize={typed}
            onChange={onChange}
            onDone={() => {
              setEditing(false);
              barRef.current?.focus({ preventScroll: true });
            }}
          />
        ) : (
          <span
            ref={valueRef}
            className="dial-value"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setEditing(true)}
          >
            {value}
            {unit ? <small>{unit}</small> : null}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The number, ready to type over: it's selected when it opens and the first key replaces it
 * (even where iOS drops the selection). Deleting leaves it empty instead of snapping back,
 * valid numbers apply as you type, Enter or leaving finishes, Escape restores the old value.
 */
function DialInput({
  label,
  value,
  min,
  limit,
  quantize,
  onChange,
  onDone,
}: {
  label: string;
  value: number;
  min: number;
  limit: number;
  quantize: (v: number) => number;
  onChange: (v: number) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(String(value));
  const fresh = useRef(true);
  const original = useRef(value);
  const apply = (raw: string) => {
    const cleaned = raw.replace(/[^\d.]/g, '').slice(0, 6);
    setText(cleaned);
    const n = Number(cleaned);
    if (cleaned !== '' && Number.isFinite(n) && n >= min) onChange(quantize(Math.min(limit, n)));
  };
  const applyRef = useLatest(apply);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
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
    <input
      ref={ref}
      className="dial-input"
      type="text"
      inputMode="numeric"
      enterKeyHint="done"
      autoComplete="off"
      aria-label={`${label} value`}
      value={text}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        fresh.current = false;
        apply(e.target.value);
      }}
      onBlur={() => {
        if (text !== '' && Number(text) < min) onChange(min);
        onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          onChange(original.current);
          setText(String(original.current));
          onDone();
        }
      }}
    />
  );
}
