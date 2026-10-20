import { nowIso } from '../shared/ids';
import {
  type Annotation,
  type AnnotationDoc,
  type CommentThread,
  DEFAULT_GRID,
  DEFAULT_STYLE,
  type GridSettings,
  type Guide,
  type ImageAttachment,
  isComment,
  type Point,
  type Rect,
  type Shape,
  type ShapeStyle,
} from '../shared/model';
import { findShape, pointIn } from '../shared/targets';
import { Store } from './state';

/** `browse` leaves the page fully interactive (no capture layer). */
export type ToolId = 'browse' | 'select' | 'comment' | 'draw';
export type DrawToolId =
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'eraser'
  | 'redact';
export type ShapeToolId = 'rect' | 'ellipse' | 'line' | 'arrow' | 'redact';
export const SHAPE_TOOLS: ShapeToolId[] = ['rect', 'ellipse', 'line', 'arrow', 'redact'];

export function isShapeTool(tool: DrawToolId): tool is ShapeToolId {
  return (SHAPE_TOOLS as string[]).includes(tool);
}
export type PanelId =
  | 'none'
  | 'grid'
  | 'list'
  | 'export'
  | 'help'
  | 'welcome'
  | 'more'
  | 'settings'
  | 'screen'
  | 'layers';

/** Comment being composed (not yet part of the document / history). */
export interface DraftComment {
  target: CommentThread['target'];
}

export interface EditorState {
  tool: ToolId;
  drawTool: DrawToolId;
  /** Last shape picked from the Shapes flyout (the button shows it). */
  lastShape: ShapeToolId;
  style: ShapeStyle;
  doc: AnnotationDoc;
  past: AnnotationDoc[];
  future: AnnotationDoc[];
  /** Selected annotation (shape or comment) id: the last of `selectedIds`. */
  selectedId: string | null;
  /** Everything selected (several drawings can be; a comment is selected on its own). */
  selectedIds: string[];
  /** Comment thread whose popover is open. */
  openThreadId: string | null;
  draft: DraftComment | null;
  /** Element picked with the select tool (live inspector). */
  pickedEl: Element | null;
  // ---- transient interaction state (never persisted, not in history) ----
  hoverEl: Element | null;
  /** Drawing under the pointer in Inspect mode (move affordance). */
  hoverShapeId: string | null;
  /** Shape being drawn. */
  preview: Shape | null;
  /** Live copies of the selected drawings while they're moved or resized (committed on release). */
  liveShapes: Shape[];
  /** Area selected by dragging with the Select tool (page space). */
  pickedRegion: Rect | null;
  /** Text label being re-edited (its id). */
  editingTextId: string | null;
  /** The details card for the selected element is open. */
  showDetails: boolean;
  /** Shapes hidden while the eraser drag is in progress. */
  erasing: string[];
  /** Region being dragged with the select tool (page space). */
  region: Rect | null;
  /** Text label being typed (page space). */
  textEdit: { point: Point } | null;
  grid: GridSettings;
  rulers: boolean;
  panel: PanelId;
  /** Where the open panel's back button leads (set when it was opened from another panel). */
  panelBack: PanelId | null;
  /** A comment's attached image shown full size. */
  viewImage: ImageAttachment | null;
}

const HISTORY_LIMIT = 200;

export function emptyDoc(url: string, title: string): AnnotationDoc {
  return { url, title, brief: '', annotations: [], guides: [], updatedAt: nowIso() };
}

export function createInitialState(
  doc: AnnotationDoc,
  grid: GridSettings = DEFAULT_GRID,
): EditorState {
  return {
    tool: 'select',
    drawTool: 'pen',
    lastShape: 'rect',
    style: { ...DEFAULT_STYLE },
    doc,
    past: [],
    future: [],
    selectedId: null,
    selectedIds: [],
    openThreadId: null,
    draft: null,
    pickedEl: null,
    hoverEl: null,
    hoverShapeId: null,
    preview: null,
    liveShapes: [],
    pickedRegion: null,
    editingTextId: null,
    showDetails: false,
    erasing: [],
    region: null,
    textEdit: null,
    grid,
    rulers: false,
    panel: 'none',
    panelBack: null,
    viewImage: null,
  };
}

export function nextCommentNumber(annotations: Annotation[]): number {
  let max = 0;
  for (const a of annotations) if (isComment(a) && a.number > max) max = a.number;
  return max + 1;
}

/**
 * The editor's state (state.ts). Document changes go through `commit`, which records undo
 * history.
 */
export class EditorStore extends Store<EditorState> {
  private docListeners = new Set<(doc: AnnotationDoc) => void>();

  /** Fires after every document change (persistence hook). */
  onDocChange(listener: (doc: AnnotationDoc) => void): () => void {
    this.docListeners.add(listener);
    return () => this.docListeners.delete(listener);
  }

  override set(patch: Partial<EditorState>): void {
    // Opening a panel any other way forgets the way back.
    if ('panel' in patch && !('panelBack' in patch)) patch = { ...patch, panelBack: null };
    // `selectedId` is always the last of `selectedIds`; setting either keeps both in step.
    if ('selectedIds' in patch && !('selectedId' in patch))
      patch = { ...patch, selectedId: patch.selectedIds?.at(-1) ?? null };
    else if ('selectedId' in patch && !('selectedIds' in patch))
      patch = { ...patch, selectedIds: patch.selectedId ? [patch.selectedId] : [] };
    super.set(patch);
  }

  protected override replace(next: EditorState): void {
    const prevDoc = this.state.doc;
    super.replace(next);
    if (prevDoc !== next.doc) for (const l of this.docListeners) l(next.doc);
  }

  /** Apply an undoable document change. */
  commit(update: (doc: AnnotationDoc) => AnnotationDoc): void {
    const prev = this.state.doc;
    const past = [...this.state.past, prev].slice(-HISTORY_LIMIT);
    this.replace({
      ...this.state,
      doc: { ...update(prev), updatedAt: nowIso() },
      past,
      future: [],
    });
  }

  undo = (): void => {
    const { past, future, doc } = this.state;
    const prev = past.at(-1);
    if (prev) this.goTo(prev, { past: past.slice(0, -1), future: [doc, ...future] });
  };

  redo = (): void => {
    const { past, future, doc } = this.state;
    const next = future[0];
    if (next) this.goTo(next, { past: [...past, doc], future: future.slice(1) });
  };

  /** Show another point in history, keeping what's still there selected (and open). */
  private goTo(doc: AnnotationDoc, history: Pick<EditorState, 'past' | 'future'>): void {
    const has = (id: string) => doc.annotations.some((a) => a.id === id);
    const selectedIds = this.state.selectedIds.filter(has);
    const open = this.state.openThreadId;
    this.replace({
      ...this.state,
      ...history,
      doc,
      selectedIds,
      selectedId: selectedIds.at(-1) ?? null,
      openThreadId: open && has(open) ? open : null,
    });
  }

  /** Switch to another page's document (SPA navigation); history does not cross pages. */
  replaceDoc(doc: AnnotationDoc): void {
    this.replace({
      ...this.state,
      doc,
      past: [],
      future: [],
      selectedId: null,
      selectedIds: [],
      openThreadId: null,
      draft: null,
      pickedEl: null,
      hoverEl: null,
      hoverShapeId: null,
      preview: null,
      liveShapes: [],
      pickedRegion: null,
      editingTextId: null,
      erasing: [],
      region: null,
      textEdit: null,
      viewImage: null,
    });
  }

  canUndo(): boolean {
    return this.state.past.length > 0;
  }

  canRedo(): boolean {
    return this.state.future.length > 0;
  }

  // ---- annotation helpers -------------------------------------------------

  addAnnotation(annotation: Annotation): void {
    this.commit((doc) => ({ ...doc, annotations: [...doc.annotations, annotation] }));
  }

  /**
   * Move drawings up or down the paint order (comments keep their places). `front`/`back`
   * go all the way; `forward`/`backward` step past the next drawing.
   */
  arrange(ids: readonly string[], where: 'front' | 'forward' | 'backward' | 'back'): void {
    const set = new Set(ids);
    const shapes = this.state.doc.annotations.filter((a): a is Shape => a.type === 'shape');
    if (!shapes.some((s) => set.has(s.id))) return;
    let order = [...shapes];
    if (where === 'front')
      order = [...shapes.filter((s) => !set.has(s.id)), ...shapes.filter((s) => set.has(s.id))];
    else if (where === 'back')
      order = [...shapes.filter((s) => set.has(s.id)), ...shapes.filter((s) => !set.has(s.id))];
    else if (where === 'forward') {
      for (let i = order.length - 2; i >= 0; i--)
        if (set.has(order[i]!.id) && !set.has(order[i + 1]!.id))
          [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
    } else {
      for (let i = 1; i < order.length; i++)
        if (set.has(order[i]!.id) && !set.has(order[i - 1]!.id))
          [order[i], order[i - 1]] = [order[i - 1]!, order[i]!];
    }
    this.setShapeOrder(order.map((s) => s.id));
  }

  /** Put the drawings in this paint order (back to front); comments keep their places. */
  setShapeOrder(ids: readonly string[]): void {
    const byId = new Map(
      this.state.doc.annotations
        .filter((a): a is Shape => a.type === 'shape')
        .map((s) => [s.id, s]),
    );
    const order = ids.map((id) => byId.get(id)).filter((s): s is Shape => !!s);
    if (order.every((s, i) => s.id === [...byId.keys()][i])) return;
    let next = 0;
    this.commit((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) => (a.type === 'shape' ? (order[next++] ?? a) : a)),
    }));
  }

  /** Lock or hide drawings (one undo step). */
  setShapeFlag(ids: readonly string[], flag: 'locked' | 'hidden', on: boolean): void {
    const set = new Set(ids);
    this.commit((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) => {
        if (a.type !== 'shape' || !set.has(a.id)) return a;
        const { [flag]: _old, ...rest } = a;
        return (on ? { ...rest, [flag]: true } : rest) as Shape;
      }),
    }));
  }

  /** Replace several drawings at once (a group moved or resized): one undo step. */
  replaceShapes(shapes: readonly Shape[]): void {
    if (shapes.length === 0) return;
    const byId = new Map(shapes.map((s) => [s.id, s]));
    this.commit((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) => byId.get(a.id) ?? a),
    }));
  }

  updateAnnotation(id: string, update: (a: Annotation) => Annotation): void {
    this.commit((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) => (a.id === id ? update(a) : a)),
    }));
  }

  removeAnnotations(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const set = new Set(ids);
    this.commit((doc) => ({
      ...doc,
      annotations: doc.annotations
        .filter((a) => !set.has(a.id))
        // Comments on a deleted image or drawing stay where they were, on the page.
        .map((a) => {
          if (!isComment(a) || a.target.type !== 'shape' || !set.has(a.target.shapeId)) return a;
          const shape = findShape(doc.annotations, a.target.shapeId);
          const point = shape ? pointIn(shape, a.target.at) : a.target.point;
          return { ...a, target: { type: 'point' as const, point } };
        }),
    }));
    const { selectedIds, openThreadId } = this.state;
    this.set({
      selectedIds: selectedIds.filter((id) => !set.has(id)),
      openThreadId: openThreadId && set.has(openThreadId) ? null : openThreadId,
    });
  }

  /** Remove drawings only (comments are kept). */
  clearShapes(): void {
    const ids = this.state.doc.annotations.filter((a) => a.type === 'shape').map((a) => a.id);
    this.removeAnnotations(ids);
  }

  clearAll(): void {
    this.commit((doc) => ({ ...doc, annotations: [], guides: [] }));
    this.set({ selectedIds: [], openThreadId: null, draft: null });
  }

  setBrief(brief: string): void {
    // The brief is edited as free text; keep it out of undo history to avoid per-keystroke entries.
    this.replace({ ...this.state, doc: { ...this.state.doc, brief, updatedAt: nowIso() } });
  }

  // ---- guides ---------------------------------------------------------------

  addGuide(guide: Guide): void {
    this.commit((doc) => ({ ...doc, guides: [...doc.guides, guide] }));
  }

  moveGuide(id: string, position: number): void {
    this.commit((doc) => ({
      ...doc,
      guides: doc.guides.map((g) => (g.id === id ? { ...g, position } : g)),
    }));
  }

  clearGuides(): void {
    if (this.state.doc.guides.length === 0) return;
    this.commit((doc) => ({ ...doc, guides: [] }));
  }

  removeGuide(id: string): void {
    this.commit((doc) => ({ ...doc, guides: doc.guides.filter((g) => g.id !== id) }));
  }
}

/** The drawings currently selected (with the Select tool), in paint order. */
export function selectedShapes(s: EditorState): Shape[] {
  if (s.tool !== 'select' || s.selectedIds.length === 0) return [];
  const ids = new Set(s.selectedIds);
  return s.doc.annotations.filter((a): a is Shape => a.type === 'shape' && ids.has(a.id));
}

/** Drawings that can be picked on the page: not locked or hidden. */
export function pickable(shape: Shape): boolean {
  return !shape.locked && !shape.hidden;
}
