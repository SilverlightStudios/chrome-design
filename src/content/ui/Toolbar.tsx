import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { isComment, isShape, PALETTE, type Shape, type ShapeStyle } from '../../shared/model';
import { duplicateSelection } from '../clipboard';
import { useEditor, useEnv } from '../context';
import { capturePointer, HOST_TAG } from '../dom';
import { placeImagesFromPicker } from '../images';
import {
  GLASS_FILTER_ID,
  GlassFilters,
  supportsSvgBackdrop,
  useBackdropTone,
  useCspGlassFallback,
  useGlassMap,
} from '../motion/glass';
import { BottomSheet, FloatingSheet, useCompact, useSheetPresence } from '../motion/MorphSheet';
import { MorphTooltipGroup } from '../motion/MorphTooltip';
import { commentOnShape } from '../overlay/InteractionLayer';
import { textFontSize } from '../overlay/TextEditor';
import { loadUiPrefs, saveUiPrefs, type UiPrefs } from '../persistence';
import {
  type DrawToolId,
  type EditorState,
  isShapeTool,
  type PanelId,
  SHAPE_TOOLS,
  type ShapeToolId,
} from '../store';
import { ExportPanel } from './ExportPanel';
import { FeedbackPanel } from './FeedbackPanel';
import { GridPanel } from './GridPanel';
import { HelpPanel } from './HelpPanel';
import { Icon, type IconName } from './icons';
import { LayersPanel } from './LayersPanel';
import { MorePanel } from './MorePanel';
import { ScreenPanel } from './ScreenPanel';
import { SettingsPanel } from './SettingsPanel';
import { WelcomePanel } from './WelcomePanel';

interface ButtonProps {
  icon: IconName;
  label: string;
  kbd?: string;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  className?: string;
  longPress?: 'menu';
  expanded?: boolean;
  /** The menu this control opens (grown out of the tooltip). */
  menu?: string;
  /** Opens a panel: the tooltip gets out of the way on click. */
  hideTip?: boolean;
  onClick: () => void;
  onPointerDown?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children?: ReactNode;
}

export function ToolButton({
  icon,
  label,
  kbd,
  active,
  disabled,
  badge,
  className,
  longPress,
  expanded,
  menu,
  hideTip,
  onClick,
  onPointerDown,
  onContextMenu,
  children,
}: ButtonProps) {
  const Glyph = Icon[icon];
  return (
    <button
      type="button"
      className={`tb-btn ${className ?? ''}`}
      data-tip={label}
      data-kbd={kbd}
      data-longpress={longPress}
      data-menu={menu}
      data-tip-hide={hideTip ? '' : undefined}
      aria-label={kbd ? `${label} (${kbd})` : label}
      aria-pressed={active ?? undefined}
      aria-expanded={expanded}
      data-active={active ? '' : undefined}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      <Glyph />
      {badge ? <span className="tb-badge">{badge > 99 ? '99+' : badge}</span> : null}
      {children}
    </button>
  );
}

function Divider() {
  return <span className="tb-sep" aria-hidden="true" />;
}

const SHAPES: { id: ShapeToolId; icon: IconName; label: string; kbd: string }[] = [
  { id: 'rect', icon: 'rect', label: 'Rectangle', kbd: 'R' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', kbd: 'O' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow', kbd: 'A' },
  { id: 'line', icon: 'line', label: 'Line', kbd: 'L' },
  { id: 'redact', icon: 'eyeOff', label: 'Blur', kbd: 'B' },
];
const SHAPE_META = Object.fromEntries(SHAPES.map((s) => [s.id, s])) as Record<
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

/** Closes a flyout when the pointer goes down anywhere outside it (shadow-DOM aware). */
function useDismiss(open: boolean, inside: React.RefObject<HTMLElement | null>, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = inside.current;
      const path = e.composedPath();
      if (el && path.includes(el)) return;
      if (path.some((n) => n instanceof Element && n.hasAttribute('data-tip-menu'))) return;
      closeRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, inside]);
}

/** Pictures and blurred boxes have no colour or stroke to set. */
const plain = (k: Shape['kind']) => k === 'image' || k === 'redact';

/**
 * The contextual style bar (Figma's properties, in a capsule): colour, stroke, eraser,
 * undo/redo while drawing; colour, stroke and delete for a selected drawing.
 */
function StyleBar({ placement }: { placement: 'up' | 'down' }) {
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
      <MorphTooltipGroup placement={placement} className="subbar" ariaLabel="Style" menu={menu}>
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
      </MorphTooltipGroup>
    </div>
  );
}

const PANELS: Record<Exclude<PanelId, 'none'>, { label: string; render: () => ReactNode }> = {
  more: { label: 'More', render: () => <MorePanel /> },
  grid: { label: 'Columns', render: () => <GridPanel /> },
  list: { label: 'Comments', render: () => <FeedbackPanel /> },
  export: { label: 'Send to AI', render: () => <ExportPanel /> },
  help: { label: 'Keyboard shortcuts', render: () => <HelpPanel /> },
  welcome: { label: 'Welcome', render: () => <WelcomePanel /> },
  settings: { label: 'Settings', render: () => <SettingsPanel /> },
  screen: { label: 'Screen size', render: () => <ScreenPanel /> },
  layers: { label: 'Layers', render: () => <LayersPanel /> },
};

/** Panels reached from More; the More button stays lit and closes them. */
const MORE_CHILDREN = new Set<PanelId>(['list', 'grid', 'help', 'settings', 'screen', 'layers']);

const skipOwnUi = (el: Element) => el.localName === HOST_TAG;

function clampPosition(p: UiPrefs['toolbar'], barWidth: number): UiPrefs['toolbar'] {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const w = barWidth || 400;
  const maxX = Math.max(0, vw / 2 - w / 2 - 8);
  return {
    edge: p.edge,
    x: Math.max(-maxX, Math.min(maxX, p.x)),
    y: Math.max(0, Math.min(vh / 2 - 60, p.y)),
  };
}

export function Toolbar() {
  const env = useEnv();
  const { store } = env;
  const tool = useEditor((s) => s.tool);
  const drawTool = useEditor((s) => s.drawTool);
  const lastShape = useEditor((s) => s.lastShape);
  const panel = useEditor((s) => s.panel);
  const selectedShape = useEditor(
    (s) =>
      s.tool === 'select' &&
      s.selectedIds.length > 0 &&
      s.doc.annotations.some((a) => isShape(a) && s.selectedIds.includes(a.id)),
  );
  const openCount = useEditor(
    (s) => s.doc.annotations.filter((a) => isComment(a) && a.status === 'open').length,
  );
  const compact = useCompact();
  const [pos, setPos] = useState<UiPrefs['toolbar']>({ edge: 'bottom', x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{
    px: number;
    py: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const shapesRef = useRef<HTMLDivElement>(null);
  const map = useGlassMap(barRef);
  const cspBlocked = useCspGlassFallback();
  const tone = useBackdropTone(barRef, skipOwnUi);
  const [, force] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [shapesOpen, setShapesOpen] = useState(false);
  const longPress = useRef<{ timer: number; fired: boolean }>({ timer: 0, fired: false });
  useDismiss(shapesOpen, shapesRef, () => setShapesOpen(false));

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const ro = new ResizeObserver(() => setBarWidth(bar.offsetWidth));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    void loadUiPrefs().then((p) => {
      setPos(p.toolbar);
      const patch: Partial<EditorState> = {};
      if (p.style) patch.style = p.style;
      if (p.lastShape && (SHAPE_TOOLS as string[]).includes(p.lastShape))
        patch.lastShape = p.lastShape as ShapeToolId;
      // Someone opening a shared file is shown the feedback, not the intro.
      if (!p.onboarded && !env.handoff && store.getState().panel === 'none')
        patch.panel = 'welcome';
      store.set(patch);
    });
    const onResize = () => force((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [store, env.handoff]);

  // The intro counts as seen once it has been put away, however that happened.
  const prevPanel = useRef(panel);
  useEffect(() => {
    if (prevPanel.current === 'welcome' && panel !== 'welcome')
      void saveUiPrefs({ onboarded: true });
    prevPanel.current = panel;
  }, [panel]);

  const choose = (next: 'select' | 'comment') => {
    const s = store.getState();
    store.set({
      tool: next,
      selectedId: null,
      draft: null,
      pickedEl: next === 'select' ? s.pickedEl : null,
      hoverEl: null,
    });
  };
  const chooseDraw = (next: DrawToolId) => {
    const s = store.getState();
    // Tapping the active drawing tool again puts it down (back to Select).
    const same =
      s.tool === 'draw' && (s.drawTool === next || (next === 'pen' && s.drawTool === 'eraser'));
    if (same) {
      store.set({ tool: 'select' });
      return;
    }
    const patch: Partial<EditorState> = {
      tool: 'draw',
      drawTool: next,
      selectedId: null,
      pickedEl: null,
      pickedRegion: null,
      hoverEl: null,
    };
    if (isShapeTool(next)) {
      patch.lastShape = next;
      void saveUiPrefs({ lastShape: next });
    }
    store.set(patch);
  };
  const togglePanel = (next: PanelId) => store.set({ panel: panel === next ? 'none' : next });

  const shapeActive = tool === 'draw' && isShapeTool(drawTool);
  const onShapesClick = () => {
    if (longPress.current.fired) {
      longPress.current.fired = false;
      return;
    }
    if (shapeActive) setShapesOpen((o) => !o);
    else chooseDraw(lastShape);
  };
  const onShapesDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    window.clearTimeout(longPress.current.timer);
    longPress.current.fired = false;
    if (e.pointerType !== 'touch') return;
    longPress.current.timer = window.setTimeout(() => {
      longPress.current.fired = true;
      setShapesOpen(true);
    }, 420);
  };

  // Drag the whole dock by the bar's background (anything that is not a control).
  const onBarPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button, input, label, [data-tip-menu]'))
      return;
    const bar = barRef.current;
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    capturePointer(bar, e.pointerId);
    dragStart.current = {
      px: e.clientX,
      py: e.clientY,
      left: r.left + r.width / 2,
      top: pos.edge === 'bottom' ? r.bottom : r.top,
      moved: false,
    };
  };
  const onBarPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragStart.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setDrag({ x: d.left + dx, y: d.top + dy });
  };
  const onBarPointerUp = () => {
    window.clearTimeout(longPress.current.timer);
    const d = dragStart.current;
    dragStart.current = null;
    if (!d?.moved || !drag) {
      setDrag(null);
      return;
    }
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const edge: 'top' | 'bottom' = drag.y < vh / 2 ? 'top' : 'bottom';
    const next = clampPosition(
      { edge, x: drag.x - vw / 2, y: edge === 'bottom' ? vh - drag.y - 16 : drag.y - 16 },
      barWidth,
    );
    setPos(next);
    setDrag(null);
    void saveUiPrefs({ toolbar: next });
  };
  const resetPosition = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('button')) return;
    const next = { edge: 'bottom' as const, x: 0, y: 0 };
    setPos(next);
    void saveUiPrefs({ toolbar: next });
  };

  const placed = clampPosition(pos, barWidth);
  const edge: 'top' | 'bottom' = drag
    ? drag.y < window.innerHeight / 2
      ? 'top'
      : 'bottom'
    : compact
      ? 'bottom'
      : placed.edge;
  const placement = edge === 'bottom' ? 'up' : 'down';
  const dockStyle = drag
    ? edge === 'bottom'
      ? { left: drag.x, bottom: window.innerHeight - drag.y }
      : { left: drag.x, top: drag.y }
    : compact
      ? { left: '50%', bottom: 'max(12px, env(safe-area-inset-bottom))' }
      : placed.edge === 'bottom'
        ? {
            left: `calc(50% + ${placed.x}px)`,
            bottom: `calc(max(16px, env(safe-area-inset-bottom)) + ${placed.y}px)`,
          }
        : {
            left: `calc(50% + ${placed.x}px)`,
            top: `calc(max(16px, env(safe-area-inset-top)) + ${placed.y}px)`,
          };

  const sheet = useSheetPresence<Exclude<PanelId, 'none'>>(panel === 'none' ? null : panel);
  const styleBar = useSheetPresence<'style'>(tool === 'draw' || selectedShape ? 'style' : null);
  const glassMode = cspBlocked || !map || !supportsSvgBackdrop() ? 'css' : 'svg';
  const renderPanel = (key: string) => PANELS[key as Exclude<PanelId, 'none'>].render();
  const sheetOpenOnPhone = compact && sheet.shown !== null && sheet.phase === 'open';

  const shapesMenu = shapesOpen
    ? {
        owner: 'shapes',
        label: 'Shapes',
        content: (
          <div className="shape-menu" role="menu" aria-label="Shapes">
            {SHAPES.map((s) => {
              const Glyph = Icon[s.icon];
              return (
                <button
                  key={s.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={shapeActive && drawTool === s.id}
                  className="menu-item"
                  data-active={drawTool === s.id && shapeActive ? '' : undefined}
                  onClick={() => {
                    chooseDraw(s.id);
                    setShapesOpen(false);
                  }}
                >
                  <Glyph />
                  <span>{s.label}</span>
                  <kbd>{s.kbd}</kbd>
                </button>
              );
            })}
          </div>
        ),
      }
    : null;
  return (
    <>
      <div
        ref={dockRef}
        className="dock ui"
        data-edge={edge}
        data-dragging={drag ? '' : undefined}
        data-covered={sheetOpenOnPhone ? '' : undefined}
        style={dockStyle}
      >
        <GlassFilters map={glassMode === 'svg' ? map : null} />
        {!compact && sheet.shown && (
          <FloatingSheet
            phase={sheet.phase}
            contentKey={sheet.shown}
            render={renderPanel}
            anchor={edge}
            className="panel-shell glass-css"
            label={PANELS[sheet.shown].label}
            onClosed={sheet.onClosed}
          />
        )}
        {styleBar.shown && (
          <FloatingSheet
            phase={styleBar.phase}
            contentKey="style"
            render={() => <StyleBar placement={placement} />}
            anchor={edge}
            className="subbar-shell glass-css"
            label="Style"
            onClosed={styleBar.onClosed}
          />
        )}
        <div
          ref={barRef}
          className="toolbar"
          data-glass={glassMode}
          data-tone={tone}
          style={
            glassMode === 'svg'
              ? { ['--glass-filter' as string]: `url(#${GLASS_FILTER_ID})` }
              : undefined
          }
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          onPointerCancel={onBarPointerUp}
          onDoubleClick={resetPosition}
        >
          <MorphTooltipGroup
            placement={placement}
            className="toolbar-row"
            ariaLabel="Chrome Design"
            onPointerDown={onBarPointerDown}
            menu={shapesMenu}
          >
            <ToolButton
              icon="close"
              label="Close"
              kbd="⌥⇧D"
              className="close"
              onClick={env.close}
            />
            <Divider />
            <ToolButton
              icon="select"
              label="Select"
              kbd="V"
              active={tool === 'select'}
              onClick={() => choose('select')}
            />
            <ToolButton
              icon="comment"
              label="Comment"
              kbd="C"
              active={tool === 'comment'}
              onClick={() => choose('comment')}
            />
            <ToolButton
              icon="draw"
              label="Pencil"
              kbd="P"
              active={tool === 'draw' && (drawTool === 'pen' || drawTool === 'eraser')}
              onClick={() => chooseDraw('pen')}
            />
            <div className="tb-pop-anchor" ref={shapesRef}>
              <ToolButton
                icon={SHAPE_META[lastShape].icon}
                label="Shapes"
                kbd={SHAPE_META[lastShape].kbd}
                className="has-menu"
                menu="shapes"
                longPress="menu"
                expanded={shapesOpen}
                active={shapeActive}
                onClick={onShapesClick}
                onPointerDown={onShapesDown}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setShapesOpen(true);
                }}
              >
                <span className="menu-mark" aria-hidden="true" />
              </ToolButton>
            </div>
            <ToolButton
              icon="text"
              label="Text"
              kbd="T"
              active={tool === 'draw' && drawTool === 'text'}
              onClick={() => chooseDraw('text')}
            />
            <ToolButton
              icon="image"
              label="Image"
              kbd="⇧⌘K"
              onClick={() => void placeImagesFromPicker(store, env.toast)}
            />
            <Divider />
            <ToolButton
              icon="more"
              label="More"
              hideTip
              active={panel === 'more' || MORE_CHILDREN.has(panel)}
              badge={openCount}
              onClick={() => togglePanel(MORE_CHILDREN.has(panel) ? panel : 'more')}
            />
            <ToolButton
              icon="export"
              label="Send to AI"
              hideTip
              kbd="⇧E"
              className="droplet"
              active={panel === 'export'}
              onClick={() => togglePanel('export')}
            />
          </MorphTooltipGroup>
        </div>
      </div>
      {compact && sheet.shown && (
        <BottomSheet
          phase={sheet.phase}
          contentKey={sheet.shown}
          render={renderPanel}
          className="glass-sheet"
          label={PANELS[sheet.shown].label}
          onClosed={sheet.onClosed}
          onDismiss={() => store.set({ panel: 'none' })}
        />
      )}
    </>
  );
}
