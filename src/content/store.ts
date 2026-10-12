import { nowIso } from '../shared/ids';
import {
  type Annotation,
  type AnnotationDoc,
  type CommentThread,
  DEFAULT_GRID,
  DEFAULT_STYLE,
  type GridSettings,
  type Guide,
  isComment,
  type Point,
  type Rect,
  type Shape,
  type ShapeStyle,
} from '../shared/model';

/** `browse` leaves the page fully interactive (no capture layer). */
export type ToolId = 'browse' | 'select' | 'comment' | 'draw';
export type DrawToolId = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eraser';
export type ShapeToolId = 'rect' | 'ellipse' | 'line' | 'arrow';
export const SHAPE_TOOLS: ShapeToolId[] = ['rect', 'ellipse', 'line', 'arrow'];

export function isShapeTool(tool: DrawToolId): tool is ShapeToolId {
  return (SHAPE_TOOLS as string[]).includes(tool);
}
export type PanelId = 'none' | 'grid' | 'list' | 'export' | 'help' | 'welcome' | 'more';

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
  /** Selected annotation (shape or comment) id. */
  selectedId: string | null;
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
  /** Live copy of the selected drawing while it is moved or resized (committed on release). */
  liveShape: Shape | null;
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
    openThreadId: null,
    draft: null,
    pickedEl: null,
    hoverEl: null,
    hoverShapeId: null,
    preview: null,
    liveShape: null,
    pickedRegion: null,
    editingTextId: null,
    showDetails: false,
    erasing: [],
    region: null,
    textEdit: null,
    grid,
    rulers: false,
    panel: 'none',
  };
}

export function nextCommentNumber(annotations: Annotation[]): number {
  let max = 0;
  for (const a of annotations) if (isComment(a) && a.number > max) max = a.number;
  return max + 1;
}

type Listener = () => void;

/**
 * Minimal external store (works with React's useSyncExternalStore and in plain tests).
 * Document mutations go through `commit`, which records undo history.
 */
export class EditorStore {
  private state: EditorState;
  private listeners = new Set<Listener>();
  private docListeners = new Set<(doc: AnnotationDoc) => void>();

  constructor(initial: EditorState) {
    this.state = initial;
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Fires after every document change (persistence hook). */
  onDocChange(listener: (doc: AnnotationDoc) => void): () => void {
    this.docListeners.add(listener);
    return () => this.docListeners.delete(listener);
  }

  set(patch: Partial<EditorState>): void {
    const prevDoc = this.state.doc;
    this.state = { ...this.state, ...patch };
    this.emit(prevDoc);
  }

  private emit(prevDoc: AnnotationDoc): void {
    for (const l of this.listeners) l();
    if (prevDoc !== this.state.doc) for (const l of this.docListeners) l(this.state.doc);
  }

  /** Apply an undoable document change. */
  commit(update: (doc: AnnotationDoc) => AnnotationDoc): void {
    const prev = this.state.doc;
    const next = { ...update(prev), updatedAt: nowIso() };
    const past = [...this.state.past, prev].slice(-HISTORY_LIMIT);
    this.state = { ...this.state, doc: next, past, future: [] };
    this.emit(prev);
  }

  undo = (): void => {
    const { past, future, doc } = this.state;
    const prev = past[past.length - 1];
    if (!prev) return;
    this.state = {
      ...this.state,
      doc: prev,
      past: past.slice(0, -1),
      future: [doc, ...future],
      selectedId: this.keepIfExists(prev, this.state.selectedId),
      openThreadId: this.keepIfExists(prev, this.state.openThreadId),
    };
    this.emit(doc);
  };

  redo = (): void => {
    const { past, future, doc } = this.state;
    const next = future[0];
    if (!next) return;
    this.state = {
      ...this.state,
      doc: next,
      past: [...past, doc],
      future: future.slice(1),
      selectedId: this.keepIfExists(next, this.state.selectedId),
      openThreadId: this.keepIfExists(next, this.state.openThreadId),
    };
    this.emit(doc);
  };

  private keepIfExists(doc: AnnotationDoc, id: string | null): string | null {
    return id && doc.annotations.some((a) => a.id === id) ? id : null;
  }

  /** Switch to another page's document (SPA navigation); history does not cross pages. */
  replaceDoc(doc: AnnotationDoc): void {
    const prev = this.state.doc;
    this.state = {
      ...this.state,
      doc,
      past: [],
      future: [],
      selectedId: null,
      openThreadId: null,
      draft: null,
      pickedEl: null,
      hoverEl: null,
      hoverShapeId: null,
      preview: null,
      liveShape: null,
      pickedRegion: null,
      editingTextId: null,
      erasing: [],
      region: null,
      textEdit: null,
    };
    this.emit(prev);
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

  updateAnnotation(id: string, update: (a: Annotation) => Annotation): void {
    this.commit((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) => (a.id === id ? update(a) : a)),
    }));
  }

  removeAnnotations(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const set = new Set(ids);
    this.commit((doc) => ({ ...doc, annotations: doc.annotations.filter((a) => !set.has(a.id)) }));
    const { selectedId, openThreadId } = this.state;
    this.set({
      selectedId: selectedId && set.has(selectedId) ? null : selectedId,
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
    this.set({ selectedId: null, openThreadId: null, draft: null });
  }

  setBrief(brief: string): void {
    // The brief is edited as free text; keep it out of undo history to avoid per-keystroke entries.
    const prev = this.state.doc;
    this.state = { ...this.state, doc: { ...prev, brief, updatedAt: nowIso() } };
    this.emit(prev);
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
