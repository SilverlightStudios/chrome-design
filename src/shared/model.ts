/**
 * Typed models shared by the content script, service worker, popup and export pipeline.
 * All coordinates are CSS pixels in *page* space (document origin, not viewport),
 * measured at the viewport width recorded in `PageMeta.viewport`.
 */

export const APP_NAME = 'Chrome Design';
export const APP_VERSION = '0.1.0';
export const SCHEMA_VERSION = '1.0.0';
export const SCHEMA_ID = `urn:chrome-design:handoff:${SCHEMA_VERSION}`;
export const PAYLOAD_KIND = 'chrome-design.handoff';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A pointer to a DOM element, resolvable in both the live page and the snapshot. */
export interface ElementAnchor {
  /** CSS selector that matched exactly this element when the anchor was created. */
  selector: string;
  /** Short human-readable ancestry, e.g. `main > section.hero > h1`. */
  path: string;
  tagName: string;
  id?: string;
  classList: string[];
  role?: string;
  ariaLabel?: string;
  /** Visible text excerpt (≤ 140 chars). */
  text?: string;
  /** Element border box in page space at the time the anchor was created. */
  rect: Rect;
  /** Small set of computed styles that are useful for design review. */
  styles: Record<string, string>;
  /** Value of the `data-cd-ref` attribute stamped on this element in the snapshot. */
  ref?: string;
}

export type CommentIntent = 'change' | 'decision' | 'question' | 'note';
export type CommentStatus = 'open' | 'resolved';

export interface CommentMessage {
  id: string;
  body: string;
  createdAt: string;
}

export type CommentTarget =
  | { type: 'point'; point: Point; anchor?: ElementAnchor }
  | { type: 'element'; point: Point; anchor: ElementAnchor }
  | { type: 'region'; rect: Rect; anchors: ElementAnchor[] };

export interface CommentThread {
  id: string;
  type: 'comment';
  /** 1-based display number, stable once assigned. */
  number: number;
  intent: CommentIntent;
  status: CommentStatus;
  target: CommentTarget;
  messages: CommentMessage[];
  createdAt: string;
  updatedAt: string;
}

export type ShapeKind = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text';

export interface ShapeStyle {
  color: string;
  width: number;
  dashed: boolean;
}

interface ShapeBase {
  id: string;
  type: 'shape';
  style: ShapeStyle;
  createdAt: string;
}

export interface PenShape extends ShapeBase {
  kind: 'pen';
  points: Point[];
}

export interface SegmentShape extends ShapeBase {
  kind: 'line' | 'arrow';
  from: Point;
  to: Point;
}

export interface BoxShape extends ShapeBase {
  kind: 'rect' | 'ellipse';
  rect: Rect;
}

export interface TextShape extends ShapeBase {
  kind: 'text';
  point: Point;
  text: string;
  fontSize: number;
}

export type Shape = PenShape | SegmentShape | BoxShape | TextShape;
export type Annotation = CommentThread | Shape;

export interface Guide {
  id: string;
  /** `x` = vertical line at page x; `y` = horizontal line at page y. */
  axis: 'x' | 'y';
  position: number;
}

export interface GridSettings {
  visible: boolean;
  mode: 'stretch' | 'fixed';
  count: number;
  /** Column width in px, used when mode is `fixed`. */
  columnWidth: number;
  margin: number;
  gutter: number;
  color: string;
  /** 0–100 */
  opacity: number;
}

/** Everything the designer authored for one page (persisted per URL). */
export interface AnnotationDoc {
  url: string;
  title: string;
  brief: string;
  annotations: Annotation[];
  guides: Guide[];
  updatedAt: string;
}

export interface PageMeta {
  url: string;
  title: string;
  lang: string;
  charset: string;
  capturedAt: string;
  timeZone: string;
  userAgent: string;
  colorScheme: 'light' | 'dark';
  viewport: { width: number; height: number; devicePixelRatio: number };
  scroll: { x: number; y: number };
  document: { width: number; height: number };
}

export type WarningCode =
  | 'asset-not-embedded'
  | 'asset-too-large'
  | 'stylesheet-unreadable'
  | 'frame-not-captured'
  | 'canvas-tainted'
  | 'media-flattened'
  | 'closed-shadow-root'
  | 'screenshot-unavailable'
  | 'size-budget-exceeded';

export interface CaptureWarning {
  code: WarningCode;
  message: string;
  url?: string;
}

export interface SanitizeReport {
  scripts: number;
  eventHandlers: number;
  javascriptUrls: number;
  frames: number;
  embeds: number;
  other: number;
}

export interface AssetReport {
  embedded: number;
  embeddedBytes: number;
  failed: number;
}

/** Output of the in-page capture step, input to the document builder. */
export interface PageCapture {
  meta: PageMeta;
  /** Sanitized, self-contained HTML document used for the static preview. */
  snapshotHtml: string;
  /** Rendered DOM as serialized at capture time, minus the extension UI. Never rendered. */
  sourceHtml: string;
  sanitize: SanitizeReport;
  assets: AssetReport;
  warnings: CaptureWarning[];
  /** Viewport screenshot (PNG data URL) taken with annotations visible, toolbar hidden. */
  screenshot?: { dataUrl: string; width: number; height: number };
}

export interface HandoffPayload {
  $schema: typeof SCHEMA_ID;
  schemaVersion: typeof SCHEMA_VERSION;
  kind: typeof PAYLOAD_KIND;
  generator: { name: string; version: string };
  exportedAt: string;
  page: PageMeta;
  brief: string;
  agentPrompt: string;
  summary: {
    comments: number;
    openComments: number;
    changeRequests: number;
    decisions: number;
    questions: number;
    shapes: number;
  };
  annotations: Annotation[];
  guides: Guide[];
  grid?: GridSettings;
  sanitize: SanitizeReport;
  assets: AssetReport;
  warnings: CaptureWarning[];
  blocks: {
    snapshot: { elementId: string; mediaType: 'text/html'; escaping: string; bytes: number };
    source: { elementId: string; mediaType: 'application/json'; bytes: number };
    schema: { elementId: string };
    screenshot?: { elementId: string; width: number; height: number };
  };
}

export const DEFAULT_GRID: GridSettings = {
  visible: false,
  mode: 'stretch',
  count: 12,
  columnWidth: 72,
  margin: 24,
  gutter: 24,
  color: '#008BFF',
  opacity: 10,
};

export const DEFAULT_STYLE: ShapeStyle = { color: '#3B82F6', width: 3, dashed: false };

export const PALETTE = ['#3B82F6', '#EF4444', '#F59E0B', '#22C55E', '#A855F7', '#111827', '#FFFFFF'];

export const INTENT_LABEL: Record<CommentIntent, string> = {
  change: 'Change request',
  decision: 'Decision',
  question: 'Question',
  note: 'Note',
};

export function isComment(a: Annotation): a is CommentThread {
  return a.type === 'comment';
}

export function isShape(a: Annotation): a is Shape {
  return a.type === 'shape';
}
