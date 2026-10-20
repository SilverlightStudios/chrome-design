import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { isComment, isShape } from '../../shared/model';
import { useEditor, useEnv } from '../context';
import { capturePointer, HOST_TAG } from '../dom';
import { placeImagesFromPicker } from '../images';
import { BottomSheet } from '../motion/BottomSheet';
import { FloatingSheet } from '../motion/FloatingSheet';
import {
  GLASS_FILTER_ID,
  GlassFilters,
  supportsSvgBackdrop,
  useBackdropTone,
  useCspGlassFallback,
  useGlassMap,
} from '../motion/glass';
import { useCompact, useSheetPresence } from '../motion/sheets';
import { TooltipGroup } from '../motion/Tooltip';
import { loadUiPrefs, saveUiPrefs, type UiPrefs } from '../persistence';
import {
  type DrawToolId,
  type EditorState,
  isShapeTool,
  type PanelId,
  SHAPE_TOOLS,
  type ShapeToolId,
} from '../store';
import { useRecorder } from '../walkthrough/recorder';
import { startWalkthrough } from '../walkthrough/voice';
import { Divider, ToolButton, useDismiss } from './controls';
import { ExportPanel } from './ExportPanel';
import { FeedbackPanel } from './FeedbackPanel';
import { plural } from './format';
import { GridPanel } from './GridPanel';
import { HelpPanel } from './HelpPanel';
import { Icon } from './icons';
import { LayersPanel } from './LayersPanel';
import { MorePanel } from './MorePanel';
import { ScreenPanel } from './ScreenPanel';
import { SettingsPanel } from './SettingsPanel';
import { SHAPE_META, SHAPES, StyleBar } from './StyleBar';
import { RecordingButtons, useRecording } from './WalkthroughBar';
import { WelcomePanel } from './WelcomePanel';

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
  const commentCount = useEditor((s) => s.doc.annotations.filter(isComment).length);
  const hasWalkthrough = useRecorder((s) => !!s.result) || !!env.sentWalkthrough;
  // The Send button says what goes.
  const sendLabel = [
    'Send to AI',
    commentCount ? plural(commentCount, 'comment') : '',
    hasWalkthrough ? 'walkthrough' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const compact = useCompact();
  const recording = useRecording();
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
        data-recording={recording ? '' : undefined}
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
          <TooltipGroup
            placement={placement}
            className="toolbar-row"
            ariaLabel="Chrome Design"
            onPointerDown={onBarPointerDown}
            menu={shapesMenu}
          >
            {recording ? (
              <RecordingButtons />
            ) : (
              <>
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
                  icon="record"
                  label="Walkthrough"
                  kbd="W"
                  className="rec-start"
                  onClick={() => startWalkthrough({ host: env.host, store })}
                />
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
                  label={sendLabel}
                  hideTip
                  kbd="⇧E"
                  className="droplet"
                  active={panel === 'export'}
                  onClick={() => togglePanel('export')}
                />
              </>
            )}
          </TooltipGroup>
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
