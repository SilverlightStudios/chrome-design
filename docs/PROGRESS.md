# Build progress (resumable notes)

## Status (2026-10-19)
R12 done: walkthroughs and the voice link. All checks pass: typecheck, Oxlint, Biome, 126 unit
tests, 12 Playwright e2e tests against the real unpacked extension (a walkthrough with laser, ink,
a pin, clicks and a transcript; the voice link through the real bridge with a stand-in
recorder). Verified on the demo page in desktop Chromium and the iPhone 15 WebKit emulator
(finger ink, a tap pin, the bottom-sheet review panel).

## Rounds
- R13: owner's pass on R12. Walkthrough is a toolbar button (◉, `W`); a new recording keeps the
  last result until it finishes (More → Walkthrough reopens it). Tooltips are Spark's fluid
  tooltips everywhere (`motion/Tooltip.tsx`, `TooltipGroup`, replacing the gooey
  MorphTooltip): `data-tip` / `data-kbd` on any control; touch = hold then slide (`touch-action:
  none` on groups, `elementFromPoint` on the shadow root). Native `title` tooltips are gone.
  `<LiquidGlass>` (motion/glass.tsx) gives any bar the toolbar's glass (own filter id + map); the
  selection bar uses it, with an icon-only Comment and ↓ (`pickNav.ts` remembers where ↑ came
  from). Glass tone is dark whenever the system is in dark mode. The contact sheet is the whole
  walkthrough as one picture (`timeline()` in summary.ts feeds both it and summary.md); Save
  image in the panel; after a recorder's transcript the bundle is re-sent with `update: true`.
- R12: walkthroughs and the voice link (after Scrawl). `src/walkthrough/` is pure and runs in
  Node too (`allowImportingTsExtensions`; its files import each other with `.ts`). Recorder
  (`content/walkthrough/recorder.ts`): page stays in `browse`; window capture-phase listeners do
  everything; the `.wt-surface` only takes the pointer while ⇧ is held (not in a text field) or
  Draw is on. Pictures through a keyed queue (560 ms apart, a mark's picture is retaken as it
  grows, laser pictured at once with the live trail hidden and redrawn), ≤ 60 taken, ≤ 20 kept
  (`pickFrames`). Fields are named by label/placeholder/name, never value (`fieldName`). Voice
  link: optional `nativeMessaging`; SW `background/voiceLink.ts` holds the port (keeps the SW
  alive), routes sessions to tabs (kept after delivery for the transcript); `bridge/host.mjs`
  relays to `~/.chrome-design/voice.sock` and writes bundles to `~/.chrome-design/walkthroughs/`.
  Chromium finds hosts in `<profile>/NativeMessagingHosts`, which the e2e test uses. Spec for
  the voice recorder: docs/WALKTHROUGH.md.
- R1: the extension, capture/sanitize, one-file AI handoff export.
- R2: Remote Desktop look (Liquid Glass toolbar), Spark motion (morphing tooltip, spring sheets),
  one-click toggle, welcome/settings page, host integration (top layer, modal dialogs, CSP, SPA).
- R3: one-row toolbar (Close · Select · Comment · Pencil · Shapes · Text · More · Send to AI);
  direct manipulation of drawings (move, resize handles, edit labels, auto-return to Select);
  plain-language element names (`src/content/describe.ts`) + floating selection bar + Details;
  comment bubble with send button; More sheet of tiles; contextual style bar; phone bottom sheets on
  the Remote Desktop drawer physics; exit animations everywhere (bubble, bars, sheets, whole UI).
- R11 (owner's picks from the ranked list; #2 names on comments waits for login):
  open a handoff on the live page (More → Open file / drop; `content/importHandoff.ts` merges
  by id); comments on images and drawings (`target.type: 'shape'`, spot `at` within its box,
  `shared/targets.ts`); full-page picture by scroll-and-stitch + in-context crops
  (`captureFullPage` in exporter, block `#chrome-design-fullpage`); multi-select
  (`selectedIds`, `liveShapes`, group frame scales via `transformShape`); copy/paste/duplicate
  (`content/clipboard.ts`, HTML carrying the shapes); Blur boxes + Hide (`kind: 'redact'`,
  `content/redact.ts` masks text/pictures in the copy, drops page code); screen sizes (comment
  `viewport` + `scope`, More → Screen size via `cd:resize-window`); arrange/lock/hide + Layers
  panel (`store.arrange`, `setShapeFlag`); Copy for AI (`buildChatPrompt`, `copyForAi`).
- R10: shareable handoff. The file *is* the page copy plus a marked wrapper
  (`<!--chrome-design:begin/end-->`, `data-chrome-design-handoff` on <html>): CSP + width lock +
  viewport in head; DSD `chrome-design-static` no-JS layer (overlay SVG + comment list), data
  blocks and `#chrome-design-runtime` (the content script itself: SW `cd:get-runtime` reads
  `content.js`; the demo serves `/chrome-design.js`; inside a file it's `document.currentScript`).
  `content/index.ts` boots `bootHandoff` when the document is a handoff and there's no extension:
  `prepareHandoffPage` freezes media queries to `page.media` (recorded at capture,
  `capture/media.ts`), mounts with the payload doc (edits saved per file), Close pauses, Download
  re-captures the copy (skip `[data-chrome-design]`) reusing original meta/screenshot/source.
  Placed images get `placement {inside, covers}` at export; `images` index with file names;
  prompt rewritten (scratch board, what/how/where for images, Python extractor); `.zip` for
  agents (`export/zip.ts`, stored zip). Image links (drop html/uri-list, pasted URL) → canvas.
  Active-tools edge frame (`.active-edge`). Missing images keep their live box in the copy.
  Schema 2.0.0. Old iframe viewer (viewer-runtime/viewer-css) removed.
- R9: images. `ImageShape` (kind `image`, data URL in `src`) placed by drop / paste / the Image
  button / ⇧⌘K (`content/images.ts`: downscale to 1600px, WebP, JPEG fallback in Safari when
  opaque; `placementRect` caps at 50% viewport width, 80% on phones); window-level capture
  listeners in `overlay/ImageDrop.tsx` only while a tool is on, skipping `[data-drop-attach]`
  (the comment bubble). Corners keep proportions by default for images (⇧ frees). Comment
  messages carry `attachments` (picker, drop, paste; ≤6), shown as thumbnails, `viewImage`
  lightbox. Export: `<image>` in the overlay, `.msg-images`, prompt + schema + `summary.images`.
  `unlimitedStorage` added. Phone comment bubbles hang below the pin when neither side fits.
- R8: one guide renderer for every measurement (`Guides` in overlay/InspectOverlay.tsx: pills
  above horizontal lines, beside vertical ones, 88% opaque; margin orange, padding green); size
  pill steps aside for the bottom guide; menus grow out of the morphing tooltip (`menu` prop on
  `MorphTooltipGroup`, `data-menu` on the owning control, dark `.tip-menu`); a click keeps the
  tooltip and resizes it; Shapes corner mark ◢; menus sized to their content.
- R7: spacing guides on every selection (`edgeDistances` in shared/measure.ts, cached per element
  in overlay/spacing.ts; the selection bar keeps clear of the top/bottom guide); an open phone
  sheet whose content changes size eases its height at full width (`PullMotion.resize`,
  `--fh-live`) instead of replaying the opening morph.
- R6: phone sheets are Spark's own app drawer (StackableDrawer `motion="scrub"`, useDrawerPull):
  one number (top edge height) drives shape, content fade and scrim; open 0.42s/0.86 spring
  from the edge with width on an exponential curve from 38%; drag anywhere that isn't a control
  (scrolling list only from its top), 36px overpull; release projects velocity 0.18s; close
  1.26s critically damped toward -0.58H, removed at -24px (`PullMotion` in motion/MorphSheet.tsx).
- R5: animated icons — Lucide geometry with Lucide Animated's motion as CSS keyframes
  (`ui/icons.tsx`, `iconMotion.ts` restarts `data-play` on press / mouse enter; `data-hold` icons
  hold a hover pose).
- R4: Columns as DialKit-style bar sliders (`ui/Dial.tsx`; typed values may pass the slider end),
  rows that don't apply fold away; Columns tile toggles, a ⋯ in its corner opens the panel (the
  drawer never changes height); back buttons on panels opened from More (`panelBack` in the
  store); Settings is an in-toolbar panel (`cd:get-settings`); solid/dashed line buttons; no
  hint chips or info toasts (only Paused + Resume, and toasts with an Undo); no flavor text;
  page can't scroll under a phone sheet; rulers on a solid strip with token colours, guide
  positions always shown on touch; Shortcuts tile hidden on touch.
- R3.1 (superseded by R4): Columns panel rebuilt for touch: −/+ stepper (hold to repeat) with count presets, a number
  box you type over (deleting no longer snaps to 1), layout tiles with Space between / around /
  evenly (`GridSettings.spacing`, math in `gridColumns`), custom sliders (tap to jump, sideways drag,
  vertical swipes still scroll), colour swatches. Switching to fixed columns narrows them to fit.

## Architecture decisions
- Content script = single IIFE (`dist/content.js`) injected on demand via `chrome.scripting` (activeTab). UI is React inside an open Shadow DOM host `<chrome-design-root>` shown as a manual popover (top layer); removed entirely on close after a 240ms exit.
- Page-space annotation layer: absolutely positioned 0×0 container at document origin (scrolls natively). Toolbar/rulers/grid/selection bar use fixed positioning.
- Service worker: injection, `captureVisibleTab`, optional cross-origin asset fetch (only with optional `<all_urls>` granted from Settings → “Allow other websites”).
- Export: `src/export/build.ts` is pure (tested in Node/jsdom). Snapshot stored raw in `<script type="text/html" id="chrome-design-snapshot">` (escaping in `src/shared/escape.ts`), payload `application/json`, schema `application/schema+json`, source DOM as JSON string. Viewer runtime is one self-contained function embedded with `fn.toString()` (must not reference module scope); CSP `default-src 'none'` + script hash; snapshot iframe `sandbox="allow-same-origin"`.
- Remote assets that can't be embedded are replaced by a placeholder (`data-cd-original-*` keeps the URL) so the export never touches the network.
- vh/dvh/svh/lvh/vw units in declarations are rewritten to px for the full-height snapshot iframe.
- Motion: CSS for everything except the sheet surfaces, which run Spark's closed-form spring (`motion/spring.ts`) so retargeting mid-flight keeps velocity. `motion/presence.ts` keeps a closing surface mounted for its exit; closing surfaces are `inert` so focus and clicks move on immediately.
- Sheets never blank: the panel that arrived by a swap keeps its swap-in animation (switching back to the opening reveal restarted it from blank); a sheet closed mid-reveal or mid-swap drops all content animations.

## Ideas / not done
- Walkthroughs across full page loads (the content script goes with the page; hand the
  recording to the service worker on `pagehide`).
- Walkthrough auto-crop to the activity (Scrawl's autocrop; here the marked elements' boxes).
- Export fidelity leftovers from R2: open the viewer at the captured viewport with an outline, `image-set()` URLs, recursive capture of same-origin iframes.
- Live style/text “edit” proposals applied to the page (recorded as structured edits).
- Dragging a phone sheet from its list when scrolled to the top (only the handle and title row drag today).
