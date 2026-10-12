import { useEffect, useRef, useState } from 'react';
import { createId, nowIso } from '../../shared/ids';
import type { Point, TextShape } from '../../shared/model';
import { useEditor, useEnv } from '../context';

const FONT_FOR_WIDTH: Record<number, number> = { 2: 14, 3: 18, 5: 24, 8: 32 };

export function textFontSize(strokeWidth: number): number {
  return FONT_FOR_WIDTH[strokeWidth] ?? Math.max(12, strokeWidth * 5);
}

/** Inline editor for a text label; Enter commits, Shift+Enter adds a line, Esc cancels. */
export function TextEditor({ point }: { point: Point }) {
  const { store } = useEnv();
  const style = useEditor((s) => s.style);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const fontSize = textFontSize(style.width);

  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const text = value.replace(/\s+$/, '');
    if (text) {
      const shape: TextShape = {
        id: createId('s'),
        type: 'shape',
        kind: 'text',
        point,
        text,
        fontSize,
        style: { ...style },
        createdAt: nowIso(),
      };
      store.addAnnotation(shape);
    }
    store.set({ textEdit: null });
  };

  return (
    <textarea
      ref={ref}
      className="text-editor ui"
      style={{ left: point.x, top: point.y, fontSize, color: style.color }}
      value={value}
      rows={Math.max(1, value.split('\n').length)}
      placeholder="Label"
      aria-label="Text label"
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          done.current = true;
          store.set({ textEdit: null });
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
