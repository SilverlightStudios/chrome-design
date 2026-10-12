# Chrome Design

A Chrome extension (Manifest V3) for reviewing a live web page the way you would a Figma file: click anything to comment on it, sketch on top of the page, move and resize what you drew, then **send everything to an AI assistant as one self-contained HTML file**. The file holds a static snapshot of the page, every comment and drawing, a JSON payload with a versioned schema, and clear instructions for the assistant.

It is made for designers, so the interface stays quiet and plain: elements are named the way you would say them (“Button “Start free””, “Heading”, “Image”), not as CSS selectors. The selectors and computed styles still go into the file for the AI.

Personal-use prototype. No accounts, no server, no analytics: page content never leaves your machine unless you send the exported file to someone yourself.

## Using it

Click the Chrome Design icon (or press `⌥⇧D`) on any page to open the toolbar; click again to close it. The first time, a short three-step welcome explains the basics and puts the Comment tool in your hand.

The toolbar is one row: **Close · Select · Comment · Pencil · Shapes · Text · More ⋯ · Send to AI**. Hover a button for its name and shortcut (on touch screens, press and hold).

| Tool | Key | What it does |
| --- | --- | --- |
| Select | `V` | Click any element to select it. A small bar above it names it and offers **Comment**, **Details** (size, text style, colours you can copy, spacing, corners) and **Select the surrounding element** (`↑`; `↓` selects the first element inside). Drag over empty page to select an area. Hold `⌥` to see the spacing around the selection, or the distance to whatever you hover. Click a drawing to select it: drag to move, pull a handle to resize (`⇧` keeps proportions, or snaps lines to 45°), double-click a label to edit it, arrow keys nudge, `⌫` deletes (with Undo). `Enter` comments on the selection. |
| Comment | `C` | Hover to see what you'll comment on, click to open a comment bubble, type and press `Enter` (`⇧Enter` for a new line). Drag to comment on an area. Each comment is a Change, Decision, Question or Note, and can have replies, be resolved or deleted (with Undo). Drag a pin to move it. |
| Pencil | `P` | Freehand drawing. It stays selected so you can keep sketching; the eraser (`E`) is in the style bar. |
| Shapes | `R` `O` `A` `L` | Rectangle, ellipse, arrow and line. The button shows the last shape you used; press and hold (or right-click) it for the others. `⇧` makes squares and circles and snaps lines to 45°. After drawing, you're back in Select with the new shape selected, ready to adjust. |
| Text | `T` | Click to place a text label. |
| Style bar | | Appears above the toolbar while drawing or when a drawing is selected: colour, stroke width, dashed, eraser, delete, undo and redo. Changes apply to the selected drawing. |
| More ⋯ | | Comments list (`F`, filter by open or resolved, click to jump to one), Use the page (pauses the tools so the page works normally), Rulers (`M`, drag from a ruler to add a guide), Columns (`G`, a layout grid: count stepper and presets, Stretch / Left / Center / Right / Space between / around / evenly, sliders for width, gutter, margin and opacity, colour swatches), Shortcuts (`?`), Quick tour, Settings and Clear this page. |
| Send to AI | `⇧E` | Shows what will be included, takes an optional note for the assistant, and downloads the file. |
| Undo / redo | `⌘Z` / `⇧⌘Z` | Applies to every change: comments, drawings, guides, moves and deletes. |
| Step back | `Esc` | Each press goes back one level: closes bubbles and panels, deselects, returns to Select, then pauses the tools. While paused the page gets all its keys back. |

Annotations are saved in extension storage (`chrome.storage.local`) per page URL, so you can close the toolbar and come back later. Nothing is written to the site itself. The only page change is the toolbar's own shadow-DOM host element, and closing the toolbar removes it (it plays a short exit animation first).

### Phones, tablets and narrow windows

Below 640 px wide (or on touch screens up to 900 px) the layout switches to touch:

- The toolbar sits at the bottom. Panels open as **bottom sheets** with a handle: drag down to close, flick to dismiss, pull up for a rubber-band stretch, or tap outside. The toolbar steps aside while a sheet is open.
- Sheets keep their content on screen for the whole animation: switching panels crossfades, and closing slides the sheet away with its content still drawn.
- Element details open in a sheet instead of a floating card, so they never cover the selection bar.
- Drawings have larger touch targets. Pressing and holding a toolbar button shows its name without triggering it.
- Text fields use a 16 px font, so iOS doesn't zoom in when you type, and sheets rise above the on-screen keyboard.

Chrome extensions don't run on iPhone or Android Chrome. The touch layout is for touch-screen laptops and tablets, narrow windows, and the demo page (`pnpm demo`), which runs the real in-page UI and is how the phone experience gets tested.

## Look and motion

The look follows the owner's Remote Desktop viewer (`studio-hub/assist/public/desk`): Liquid Glass toolbar, chips, segmented controls, tiles and the bottom drawer. The motion follows Spark (`Repos/Spark`): the morphing tooltip and the StackableDrawer springs. Everything is CSS except the sheet springs, which need velocity-preserving retargeting.

- **Liquid Glass toolbar.** An SVG displacement map used as `backdrop-filter` (a port of the Remote Desktop's WebGL glass: 30 px edge refraction, frost, rim). This works in Chromium. Safari, and pages whose CSP blocks the map, get a frosted CSS glass instead. The glass tone adapts to light and dark pages.
- **Tooltips** pour out of the hovered button and travel between buttons (Spark's morphing tooltip).
- **Panels** spring from the toolbar (Spark's drawer). On phones they behave like the Remote Desktop drawer.

Measured in Chrome DevTools (`document.getAnimations()`, rAF sampling) against the reference values:

| Motion | Reference | Chrome Design |
| --- | --- | --- |
| Tooltip open delay / pour / travel / close delay / sink | 350 / 450 / 518 / 100–120 / 324 ms (Spark) | 372 / 450 / 518 / 137 / 324 ms |
| Panel open (spring, starts at 38% × 58%) | 384 ms, 10 px overshoot (Spark drawer) | settles at 388 ms; overshoot 6 px wide, 2 px tall (the same 10 px spread over the size change) |
| Panel close (content stays visible) | 180 ms (Spark drawer) | 180 ms, removed at 188 ms, content opacity 1 throughout |
| Panel switch | crossfade, never blank | old panel fades out by ~180 ms, new one is fully in by ~260 ms, no restart |
| Phone sheet open | 384 ms spring, content fades in after 36% (Remote Desktop drawer) | settles at ~348 ms, 6 px overshoot, content fully in at ~364 ms |
| Phone sheet close | 0.18 s × 1.3 spring, content rides down | off screen at ~150 ms, removed at ~313 ms, content opacity 1 throughout |
| Comment bubble close | — | fades out and shrinks back toward its pin over ~140 ms |
| Whole toolbar close | — | fades out over 200 ms and slides down 24 px over 240 ms, then everything is removed |

`prefers-reduced-motion` turns the springs and morphs into instant changes.

## The handoff file

`chrome-design-<host>-<yyyymmdd-hhmm>.html` is a single file that works offline:

1. **Agent prompt.** A prominent block at the top (also repeated in an HTML comment at the very start of the file and in the JSON payload). It tells the agent to read every comment thread and decision, find each target in the snapshot, implement the open change requests, respect the decisions, answer the questions, and return the revised HTML along with a checklist.
2. **Requested changes.** A numbered list of threads showing type, status, replies and target (selector, `data-cd-ref`, text excerpt, coordinates and computed styles), followed by a list of drawings with the comments closest to each.
3. **Snapshot + annotations.** The static page snapshot in a sandboxed iframe with an SVG overlay of pins, region outlines and drawings. You can zoom (buttons, `+`/`-`/`0`/`1`, Ctrl/⌘ + scroll, pinch) and pan (drag or scroll). Clicking a change highlights its element in the snapshot.
4. **Viewport screenshot.** Taken with the annotations visible and the toolbar hidden.
5. **Capture warnings.** Lists every asset that could not be embedded, every frame that was replaced, and similar issues.
6. **Machine-readable blocks:**
   - `#chrome-design-payload` (`application/json`): metadata, annotations, decisions, guides, grid, sanitize report and warnings.
   - `#chrome-design-schema` (`application/schema+json`): JSON Schema draft 2020-12, `$id` `urn:chrome-design:handoff:1.0.0` (source: `src/shared/schema.ts`).
   - `#chrome-design-snapshot` (`text/html`): the sanitized snapshot as raw HTML. In the stored text, only `</script`, `<script` and `<!--` get a backslash inserted after the `<`; remove one backslash to restore the original (`unescapeScriptText` in `src/shared/escape.ts`).
   - `#chrome-design-source` (`application/json` string): the original rendered DOM, unsanitized, kept for reference and never executed.

Annotation coordinates are CSS pixels from the document's top-left corner at the recorded viewport width. Anchored elements carry `data-cd-ref="cd-N"` in the snapshot.

### Safety of the exported file

- **Sanitized snapshot.** Scripts, `noscript`, event-handler attributes, `javascript:`/`vbscript:`/HTML `data:` URLs, `srcdoc`, `<base>`, meta refresh, form actions and SVG `href` animations are removed. Iframes, objects and embeds become same-size placeholders. Canvases and videos are flattened to images. Password values are masked.
- **Sandboxed rendering.** The snapshot renders in `<iframe sandbox="allow-same-origin">` (no `allow-scripts`).
- **CSP.** The whole file is under `default-src 'none'`. Only data URLs are allowed for images and fonts, and the single viewer script runs through a SHA-256 hash.
- **No network.** Assets that could not be embedded are replaced by a hatched placeholder (`data-cd-original-src` keeps the URL), so opening the file makes no network requests.
- **Escaped data.** JSON blocks escape `<`, `>`, `&`, U+2028 and U+2029. Comment text is HTML-escaped wherever it is shown.

## Setup

Requirements: Node 20+ (tested on Node 26) and pnpm 8+.

```bash
pnpm install
pnpm build          # → dist/
```

### Load the unpacked extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder. A welcome and settings page opens.
4. Pin **Chrome Design**, open any http(s) page and click the icon (or press `⌥⇧D`). Click again to close. On pages Chrome doesn't allow extensions on, the icon opens a short explanation instead.
5. Optional: turn on **Allow other websites** in Settings. It requests `<all_urls>` at runtime so the file can include images, fonts and stylesheets from CDNs that don't send CORS headers. Without it, those show up as placeholders and are listed in the file's warnings.
6. Optional: enable **Allow access to file URLs** on the extension's details page to use it on local `file://` pages.

After changing code, run `pnpm build` again and click the reload icon on the extension card. `pnpm dev` rebuilds on save (watch mode).

### Scripts

| Command | Purpose |
| --- | --- |
| `pnpm build` | Production build into `dist/` |
| `pnpm dev` | Watch build into `dist/` |
| `pnpm demo` | Runs the real in-page UI on a sample site at http://127.0.0.1:5173 (open it on a phone to test the touch layout). There is no extension runtime there, so screenshots are skipped and annotations go to `localStorage`. |
| `pnpm demo:build` | Static build of the demo into `demo-dist/` |
| `pnpm typecheck` | `tsc --noEmit` (TypeScript 7) |
| `pnpm lint` | Oxlint + Biome check |
| `pnpm lint:fix` / `pnpm format` | Auto-fix / format |
| `pnpm test` | Vitest unit tests (schema/export, sanitizer, CSS rewriting, geometry incl. resize handles, store history, shortcuts, plain-language element names) |
| `pnpm e2e:install` | One-time project-local Chromium download for e2e (`PLAYWRIGHT_BROWSERS_PATH=0`, stored in `node_modules`) |
| `pnpm test:e2e` | Builds `dist-e2e/` and runs Playwright against the real unpacked extension: welcome, comment, select and comment from the selection bar, draw then move and resize, undo/redo, export (then opens the file offline and asserts zero network requests), hostile pages (transformed root, max z-index widgets, page shortcuts, inner scrollers, modal dialogs), single-page apps, strict CSP, and phone-width bottom sheets. |
| `pnpm check` | typecheck + lint + unit tests + build |

`dist-e2e/` is a test-only build that adds `<all_urls>` host access, because automated tests can't click the toolbar icon to grant `activeTab`. Don't load it for real use.

## Architecture

```
src/
  shared/      typed models (model.ts), JSON Schema (schema.ts), escaping, geometry (hit tests, resize handles), measurement, messages
  background/  service worker: icon click / ⌥⇧D toggle, captureVisibleTab, optional asset fetch; inject.ts (restricted-page checks + on-demand injection)
  popup/       restricted-page explainer (popup.html) and the welcome & settings page (options.html)
  content/     content script (IIFE, injected on demand) with React UI in a shadow root (top layer)
    store.ts        editor state + undo/redo history (external store, framework-free)
    describe.ts     plain-language names for elements (“Button “Start free””)
    keyboard.ts     Figma-style single-key tools and the Esc chain
    overlay/        capture layer (pointer logic), page-space drawings/pins/selection handles,
                    hover + selection outlines, selection bar + details, comment bubble, text editor, rulers/grid
    ui/             toolbar (tools, Shapes menu, style bar), panels (More, Comments, Columns, Send to AI, Shortcuts, Welcome), status chip
    motion/         spring.ts (Spark's spring), glass.tsx (Liquid Glass), MorphTooltip, MorphSheet (desktop sheets + phone bottom sheets), presence.ts (exit animations)
    exporter.ts     capture → build → download
  capture/     DOM → sanitized snapshot: stylesheets (CSSOM, @import, adopted sheets, shadow roots),
               asset embedding with byte budget, viewport-unit rewriting, element anchors/selectors
  export/      pure document builder (build.ts), agent prompt, SVG overlay, self-contained viewer runtime
demo/          sample site + harness for the in-page UI (also the phone preview)
tests/         Vitest unit tests; tests/e2e Playwright extension tests
scripts/       build.mjs (three Vite builds + manifest), make-icons.mjs (dependency-free PNG icons)
```

- **Permissions:** `activeTab`, `scripting` and `storage`, plus the optional `<all_urls>` that Settings requests only when you turn on **Allow other websites**. There are no static content scripts and no host permissions by default.
- **Messages:** only the content script talks to the service worker, to ask for a screenshot or an asset fetch. The service worker checks that the sender is this extension.
- **Living on any page:** the UI is a `popover="manual"` host in the top layer, so page transforms and `z-index: 2147483647` widgets can't cover it. When the page opens a modal `<dialog>`, the host moves into it to stay usable. The stylesheet is a constructable stylesheet, which strict CSPs allow. While a tool is active, our single-key shortcuts don't reach the page; while paused, the page gets every key. Single-page-app navigations swap to that URL's notes. Pins follow elements inside inner scrollers and fixed headers.
- **Snapshot fidelity:**
  - Stylesheets are inlined in their original cascade order.
  - CSS-in-JS rules are read from the CSSOM.
  - `@font-face` keeps one format, preferring woff2.
  - `vh`/`dvh`/`svh`/`lvh`/`vw`/`vmin`/`vmax` in declarations are converted to px so `100vh` sections keep their size inside the full-height iframe. Selectors are left alone.
  - Animations jump to their end state and transitions are disabled.
  - Form values, `<details open>` and inner scroll offsets are preserved.
  - Open shadow roots become declarative shadow DOM. Closed ones are captured via `chrome.dom.openOrClosedShadowRoot`.

## Browser limitations

- Chrome doesn't allow extensions on `chrome://` pages, the New Tab page, the Chrome Web Store, other extensions' pages or the built-in PDF viewer. The popup explains this instead of failing silently.
- `activeTab` is granted when you click the icon or press the shortcut. It lasts until the tab navigates to another origin.
- Cross-origin iframes are not captured; they show up as placeholders with a warning.
- Canvases with cross-origin pixels can't be read; they become placeholders with a warning.
- WebGL canvases without `preserveDrawingBuffer` may export blank.
- Stylesheets and assets on other origins without CORS headers can't be read unless you grant the optional permission. They are listed as warnings and show up as hatched placeholders.
- The snapshot is a single static state: hover/focus states, JS-driven menus and carousels are flattened. `position: fixed` elements render relative to the top of the snapshot. Media queries based on viewport height see the full document height.
- Custom elements stay undefined in the snapshot (scripts are removed). Pages that hide `:not(:defined)` elements may lose those parts. The screenshot shows how they looked.
- Drawings live in document coordinates, so they don't follow an inner scroller (comment pins anchored to elements do).
- The Liquid Glass refraction needs Chromium's SVG `backdrop-filter`; elsewhere, and on pages whose CSP blocks `data:` images, the toolbar uses the frosted CSS glass.
- Very large pages are capped at an 80 MB embed budget (8 MB per asset). Anything over the cap is listed as a warning.

## Attribution

Chrome Design is an original implementation inspired by the workflow in [Squints](https://x.com/andreaskatzmann/status/2109119904351924379) by Andreas Katzmann: design inspection tools (inspect, rulers and guides, column grid, drawing) layered over live web pages. I studied the public demo video and the public feature description. No Squints source code, branding, logos, icons or assets were used. The interface, icon set, extension icon, code and the AI-handoff export format are original to this project. The visual language and motion follow the owner's own projects: the Remote Desktop viewer (Liquid Glass, drawer) and Spark (morphing tooltip, StackableDrawer springs).

## License

Private, for personal use (`UNLICENSED`).
