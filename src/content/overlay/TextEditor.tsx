import { useEffect, useRef, useState } from 'react';
import { createId, nowIso } from '../../shared/ids';
import type { Point, TextShape } from '../../shared/model';
import { isShape } from '../../shared/model';
import { useEditor, useEnv } from '../context';

const FONT_FOR_WIDTH: Record<number, number> = { 2: 14, 3: 18, 5: 24, 8: 32 };

export function textFontSize(strokeWidth: number): number {
  return FONT_FOR_WIDTH[strokeWidth] ?? Math.max(12, strokeWidth * 5);
}

/**
 * Inline editor for a text label — a new one at `point`, or an existing `shape` being
 * re-edited. Enter commits, Shift+Enter adds a line, Esc cancels. Like Figma, a new label
 * hands back the Select tool with the label selected.
 */
export function TextEditor({ point, shape }: { point: Point; shape?: TextShape }) {
  const { store } = useEnv();
  const currentStyle = useEditor((s) => s.style);
  const style = shape?.style ?? currentStyle;
  const [value, setValue] = useState(shape?.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const fontSize = shape?.fontSize ?? textFontSize(style.width);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (shape) el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [shape]);

  const finish = () => store.set({ textEdit: null, editingTextId: null });

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const text = value.replace(/\s+$/, '');
    if (shape) {
      if (!text) store.removeAnnotations([shape.id]);
      else if (text !== shape.text)
        store.updateAnnotation(shape.id, (a) =>
          isShape(a) && a.kind === 'text' ? { ...a, text } : a,
        );
      finish();
      return;
    }
    if (text) {
      const created: TextShape = {
        id: createId('s'),
        type: 'shape',
        kind: 'text',
        point,
        text,
        fontSize,
        style: { ...style },
        createdAt: nowIso(),
      };
      store.addAnnotation(created);
      finish();
      store.set({ tool: 'select', selectedId: created.id });
      return;
    }
    finish();
  };

  return (
    <textarea
      ref={ref}
      className="text-editor ui"
      style={{ left: point.x, top: point.y, fontSize, color: style.color }}
      value={value}
      rows={Math.max(1, value.split('\n').length)}
      placeholder="Type a label"
      aria-label="Text label"
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          done.current = true;
          finish();
        } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
