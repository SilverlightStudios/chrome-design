/**
 * Typed models shared by the content script, service worker, popup and export pipeline.
 * All coordinates are CSS pixels in *page* space (document origin, not viewport),
 * measured at the viewport width recorded in `PageMeta.viewport`.
 */

export const APP_NAME = 'Chrome Design';
export const APP_VERSION = '0.1.0';
export const SCHEMA_VERSION = '2.0.0';
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

/** An image attached to a comment message (downscaled, embedded as a data URL). */
export interface ImageAttachment {
  id: string;
  name: string;
  /** `data:image/...` URL. */
  src: string;
  width: number;
  height: number;
}

export interface CommentMessage {
  id: string;
  body: string;
  createdAt: string;
  attachments?: ImageAttachment[];
}

export type CommentTarget =
  | { type: 'point'; point: Point; anchor?: ElementAnchor }
  | { type: 'element'; point: Point; anchor: ElementAnchor }
  | { type: 'region'; rect: Rect; anchors: ElementAnchor[] }
  /**
   * On something the designer placed (an image or a drawing). `at` is the pin's spot within
   * its box (0–1 fractions), so it follows when that thing moves or is resized; `point` is
   * where it was made (kept if the thing is deleted).
   */
  | { type: 'shape'; shapeId: string; at: Point; point: Point };

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

export type ShapeKind = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'image';

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

/** A picture placed on the page (dropped, pasted or picked), e.g. a mockup or reference. */
export interface ImageShape extends ShapeBase {
  kind: 'image';
  rect: Rect;
  /** `data:image/...` URL, or the original link when the site wouldn't let it be copied. */
  src: string;
  name: string;
  /** Where it sits on the page, worked out at export (the image's place is approximate). */
  placement?: ImagePlacement;
}

export interface ImagePlacement {
  /** The smallest page element that contains the whole image: the area it belongs in. */
  inside?: ElementAnchor;
  /** Page elements under the image (mostly covered first): what it may replace or sit on. */
  covers: ElementAnchor[];
}

/** One picture in the handoff, with the file name the extractor / .zip gives it. */
export interface ImageIndexEntry {
  file: string;
  kind: 'placed' | 'attachment';
  name: string;
  /** The placed image (shape id) or the comment thread it's attached to. */
  annotationId: string;
  messageId?: string;
  attachmentId?: string;
  /** Comment number, for attachments. */
  comment?: number;
  /** Placed images: where it is on the page (CSS px, document coordinates). */
  rect?: Rect;
  /** Pixel size of the picture itself, when known. */
  width?: number;
  height?: number;
  /** False when only a link could be kept (the site didn't allow copying the picture). */
  embedded: boolean;
}

export type Shape = PenShape | SegmentShape | BoxShape | TextShape | ImageShape;
export type Annotation = CommentThread | Shape;

export interface Guide {
  id: string;
  /** `x` = vertical line at page x; `y` = horizontal line at page y. */
  axis: 'x' | 'y';
  position: number;
}

/**
 * How fixed-width columns sit inside the margins: packed to one side or the centre with the
 * gutter between them, or spread out with the gaps worked out from the free space (CSS
 * `space-between` / `space-around` / `space-evenly`).
 */
export type GridSpacing = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

export interface GridSettings {
  visible: boolean;
  mode: 'stretch' | 'fixed';
  count: number;
  /** Column width in px, used when mode is `fixed`. */
  columnWidth: number;
  /** Where fixed-width columns sit, used when mode is `fixed`. */
  spacing: GridSpacing;
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
  /**
   * How each media query in the page's CSS evaluated on the designer's screen. The handoff file
   * forces these answers so the page lays out the same in any window.
   */
  media?: Record<string, boolean>;
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
export interface FullPageShot {
  dataUrl: string;
  width: number;
  height: number;
  scale: number;
}

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
  /**
   * The whole page, top to bottom, with the feedback drawn on (JPEG data URL). `scale` is image
   * pixels per CSS pixel, so page coordinates × scale find things in it.
   */
  fullPage?: FullPageShot;
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
    images: number;
  };
  annotations: Annotation[];
  /** Every picture (placed on the page or attached to a comment) and its file name. */
  images: ImageIndexEntry[];
  guides: Guide[];
  grid?: GridSettings;
  sanitize: SanitizeReport;
  assets: AssetReport;
  warnings: CaptureWarning[];
  blocks: {
    /**
     * The page snapshot is this HTML document itself. The handoff wrapper is everything between
     * the begin/end comment markers, plus `rootAttribute` on <html>: remove those for the page.
     */
    snapshot: {
      location: 'document';
      markers: { begin: string; end: string };
      rootAttribute: string;
      bytes: number;
    };
    source: { elementId: string; mediaType: 'application/json'; bytes: number };
    schema: { elementId: string };
    screenshot?: { elementId: string; width: number; height: number };
    /** The whole page with the feedback drawn on (`page-annotated.jpg` when unpacked). */
    fullPage?: { elementId: string; width: number; height: number; scale: number };
    /** The built-in Chrome Design toolbar (runs when the file is opened in a browser). */
    runtime?: { elementId: string; bytes: number };
  };
}

export const DEFAULT_GRID: GridSettings = {
  visible: false,
  mode: 'stretch',
  count: 12,
  columnWidth: 72,
  spacing: 'center',
  margin: 24,
  gutter: 24,
  color: '#008BFF',
  opacity: 10,
};

export const DEFAULT_STYLE: ShapeStyle = { color: '#3B82F6', width: 3, dashed: false };

export const PALETTE = [
  '#3B82F6',
  '#EF4444',
  '#F59E0B',
  '#22C55E',
  '#A855F7',
  '#111827',
  '#FFFFFF',
];

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
