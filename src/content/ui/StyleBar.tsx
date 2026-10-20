import { useRef, useState } from 'react';
import { isShape, PALETTE, type Shape, type ShapeStyle } from '../../shared/model';
import { duplicateSelection } from '../clipboard';
import { useEditor, useEnv } from '../context';
import { TooltipGroup } from '../motion/Tooltip';
import { commentOnShape } from '../overlay/InteractionLayer';
import { textFontSize } from '../overlay/TextEditor';
import { saveUiPrefs } from '../persistence';
import type { ShapeToolId } from '../store';
import { Divider, ToolButton, useDismiss } from './controls';
import { Icon, type IconName } from './icons';

export const SHAPES: { id: ShapeToolId; icon: IconName; label: string; kbd: string }[] = [
  { id: 'rect', icon: 'rect', label: 'Rectangle', kbd: 'R' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', kbd: 'O' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow', kbd: 'A' },
  { id: 'line', icon: 'line', label: 'Line', kbd: 'L' },
  { id: 'redact', icon: 'eyeOff', label: 'Blur', kbd: 'B' },
];
export const SHAPE_META = Object.fromEntries(SHAPES.map((s) => [s.id, s])) as Record<
  ShapeToolId,
  (typeof SHAPES)[number]
>;

const WIDTHS = [2, 3, 5, 8];

const ARRANGE: {
  where: 'front' | 'forward' | 'backward' | 'back';
  label: string;
  icon: IconName;
  kbd: string;
}[] = [
  { where: 'front', label: 'Bring to front', icon: 'toFront', kbd: '⌥⌘]' },
  { where: 'forward', label: 'Bring forward', icon: 'forward', kbd: '⌘]' },
  { where: 'backward', label: 'Send backward', icon: 'backward', kbd: '⌘[' },
  { where: 'back', label: 'Send to back', icon: 'toBack', kbd: '⌥⌘[' },
];

/** Pictures and blurred boxes have no colour or stroke to set. */
const plain = (k: Shape['kind']) => k === 'image' || k === 'redact';

/**
 * The contextual style bar (Figma's properties, in a capsule): colour, stroke, eraser,
 * undo/redo while drawing; colour, stroke and delete for a selected drawing.
 */
export function StyleBar({ placement }: { placement: 'up' | 'down' }) {
  const { store, toast } = useEnv();
  const tool = useEditor((s) => s.tool);
  const drawTool = useEditor((s) => s.drawTool);
  const style = useEditor((s) => s.style);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const selectedIds = useEditor((s) => s.selectedIds);
  const annotations = useEditor((s) => s.doc.annotations);
  const picked =
    tool === 'select'
      ? annotations.filter((a): a is Shape => isShape(a) && selectedIds.includes(a.id))
      : [];
  /** One selected drawing (Comment works on one at a time). */
  const selected = picked.length === 1 ? picked[0] : undefined;
  const shown = (picked.find((a) => a.kind !== 'image') ?? selected)?.style ?? style;
  const allLocked = picked.length > 0 && picked.every((a) => a.locked);
  const [popover, setPopover] = useState<'color' | 'stroke' | 'arrange' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(popover !== null, ref, () => setPopover(null));

  const applyStyle = (next: ShapeStyle) => {
    store.set({ style: next });
    void saveUiPrefs({ style: next });
    if (picked.length) {
      store.replaceShapes(
        picked.map((a) =>
          a.kind === 'text'
            ? { ...a, style: next, fontSize: textFontSize(next.width) }
            : { ...a, style: next },
        ),
      );
    }
  };
  const pencilMode = tool === 'draw' && (drawTool === 'pen' || drawTool === 'eraser');
  const menu =
    popover === 'color'
      ? {
          owner: 'color',
          label: 'Colour',
          content: (
            <div className="swatches">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="swatch-btn"
                  aria-label={c}
                  data-active={shown.color.toLowerCase() === c.toLowerCase() ? '' : undefined}
                  style={{ background: c }}
                  onClick={() => {
                    applyStyle({ ...shown, color: c });
                    setPopover(null);
                  }}
                />
              ))}
              <label className="swatch-btn custom" aria-label="Custom colour">
                <input
                  type="color"
                  value={shown.color.length === 7 ? shown.color : '#3b82f6'}
                  onChange={(e) => applyStyle({ ...shown, color: e.target.value.toUpperCase() })}
                />
              </label>
            </div>
          ),
        }
      : popover === 'stroke'
        ? {
            owner: 'stroke',
            label: 'Stroke',
            content: (
              <div className="stroke-menu">
                <div className="width-row">
                  {WIDTHS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      className="width-btn"
                      aria-label={`${w}px`}
                      data-active={shown.width === w ? '' : undefined}
                      onClick={() => applyStyle({ ...shown, width: w })}
                    >
                      <span style={{ height: w }} />
                    </button>
                  ))}
                </div>
                <div className="width-row" role="radiogroup" aria-label="Line style">
                  {[false, true].map((dashed) => (
                    <button
                      key={String(dashed)}
                      type="button"
                      role="radio"
                      className="width-btn"
                      aria-checked={shown.dashed === dashed}
                      aria-label={dashed ? 'Dashed line' : 'Solid line'}
                      data-active={shown.dashed === dashed ? '' : undefined}
                      onClick={() => applyStyle({ ...shown, dashed })}
                    >
                      <span className="line-sample" data-dashed={dashed ? '' : undefined} />
                    </button>
                  ))}
                </div>
              </div>
            ),
          }
        : popover === 'arrange'
          ? {
              owner: 'arrange',
              label: 'Arrange',
              content: (
                <div className="shape-menu" role="menu" aria-label="Arrange">
                  {ARRANGE.map((item) => {
                    const Glyph = Icon[item.icon];
                    return (
                      <button
                        key={item.where}
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        onClick={() => {
                          store.arrange(
                            picked.map((a) => a.id),
                            item.where,
                          );
                          setPopover(null);
                        }}
                      >
                        <Glyph />
                        <span>{item.label}</span>
                        <kbd>{item.kbd}</kbd>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      store.setShapeFlag(
                        picked.map((a) => a.id),
                        'locked',
                        !allLocked,
                      );
                      setPopover(null);
                    }}
                  >
                    {allLocked ? <Icon.unlock /> : <Icon.lock />}
                    <span>{allLocked ? 'Unlock' : 'Lock'}</span>
                    <kbd>⇧⌘L</kbd>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      store.setShapeFlag(
                        picked.map((a) => a.id),
                        'hidden',
                        true,
                      );
                      store.set({ selectedIds: [] });
                      setPopover(null);
                    }}
                  >
                    <Icon.eyeOff />
                    <span>Hide</span>
                    <kbd>⇧⌘H</kbd>
                  </button>
                </div>
              ),
            }
          : null;

  // A picture has no colour or stroke to set.
  const styled =
    picked.length === 0
      ? !(tool === 'draw' && drawTool === 'redact')
      : picked.some((a) => !plain(a.kind));

  return (
    <div ref={ref}>
      <TooltipGroup placement={placement} className="subbar" ariaLabel="Style" menu={menu}>
        {styled ? (
          <>
            <button
              type="button"
              className="tb-btn"
              data-tip="Colour"
              data-menu="color"
              aria-label="Colour"
              aria-expanded={popover === 'color'}
              onClick={() => setPopover(popover === 'color' ? null : 'color')}
            >
              <span className="swatch" style={{ background: shown.color }} />
            </button>
            <button
              type="button"
              className="tb-btn"
              data-tip="Stroke"
              data-menu="stroke"
              aria-label="Stroke"
              aria-expanded={popover === 'stroke'}
              onClick={() => setPopover(popover === 'stroke' ? null : 'stroke')}
            >
              <span
                className="stroke-preview"
                data-dashed={shown.dashed ? '' : undefined}
                style={{ height: Math.min(7, shown.width) }}
              />
            </button>
          </>
        ) : null}
        {pencilMode ? (
          <ToolButton
            icon="eraser"
            label="Eraser"
            kbd="E"
            active={drawTool === 'eraser'}
            onClick={() => store.set({ drawTool: drawTool === 'eraser' ? 'pen' : 'eraser' })}
          />
        ) : null}
        {picked.length ? (
          <>
            {styled ? <Divider /> : null}
            {selected ? (
              <ToolButton
                icon="comment"
                label="Comment"
                kbd="↵"
                onClick={() => commentOnShape(store, selected)}
              />
            ) : null}
            <ToolButton
              icon="copy"
              label="Duplicate"
              kbd="⌘D"
              onClick={() => duplicateSelection(store)}
            />
            <button
              type="button"
              className="tb-btn"
              data-tip="Arrange"
              data-menu="arrange"
              aria-label="Arrange"
              aria-expanded={popover === 'arrange'}
              onClick={() => setPopover(popover === 'arrange' ? null : 'arrange')}
            >
              <Icon.more />
            </button>
            <ToolButton
              icon="trash"
              label="Delete"
              kbd="⌫"
              onClick={() => {
                store.removeAnnotations(picked.map((a) => a.id));
                toast(
                  picked.length > 1
                    ? `${picked.length} items deleted`
                    : styled
                      ? 'Drawing deleted'
                      : 'Image deleted',
                  { label: 'Undo', run: store.undo },
                );
              }}
            />
          </>
        ) : null}
        <Divider />
        <ToolButton icon="undo" label="Undo" kbd="⌘Z" disabled={!canUndo} onClick={store.undo} />
        <ToolButton icon="redo" label="Redo" kbd="⇧⌘Z" disabled={!canRedo} onClick={store.redo} />
      </TooltipGroup>
    </div>
  );
}
