import { nowIso } from '../shared/ids';
import {
  type Annotation,
  type AnnotationDoc,
  type CommentThread,
  DEFAULT_GRID,
  DEFAULT_STYLE,
  type ElementAnchor,
  type GridSettings,
  type Guide,
  isComment,
  type ShapeStyle,
} from '../shared/model';

export type ToolId = 'select' | 'comment' | 'draw' | 'measure';
export type DrawToolId = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eraser';
export type PanelId = 'none' | 'grid' | 'list' | 'export' | 'help';

/** Comment being composed (not yet part of the document / history). */
export interface DraftComment {
  target: CommentThread['target'];
}

export interface EditorState {
  tool: ToolId;
  drawTool: DrawToolId;
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
  pickedElement: ElementAnchor | null;
  grid: GridSettings;
  rulers: boolean;
  panel: PanelId;
}

const HISTORY_LIMIT = 200;

export function emptyDoc(url: string, title: string): AnnotationDoc {
  return { url, title, brief: '', annotations: [], guides: [], updatedAt: nowIso() };
}

export function createInitialState(doc: AnnotationDoc, grid: GridSettings = DEFAULT_GRID): EditorState {
  return {
    tool: 'select',
    drawTool: 'pen',
    style: { ...DEFAULT_STYLE },
    doc,
    past: [],
    future: [],
    selectedId: null,
    openThreadId: null,
    draft: null,
    pickedElement: null,
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

  removeGuide(id: string): void {
    this.commit((doc) => ({ ...doc, guides: doc.guides.filter((g) => g.id !== id) }));
  }
}
