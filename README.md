# Chrome Design

A Chrome extension (Manifest V3) for reviewing a live web page like a designer: inspect and measure elements, pin comments and decisions, draw on top of the page, then **download one self-contained HTML file** you can hand to an AI coding or design agent. The file holds a static snapshot of the page, every annotation, a JSON payload with a versioned schema, and an explicit prompt telling the agent what to do.

Personal-use prototype. No accounts, no server, no analytics: page content never leaves your machine unless you send the exported file to someone yourself.

## Features

| Tool | Key | What it does |
| --- | --- | --- |
| Inspect | `V` | Hover to see the box model (margin / padding / content) and size. Click to select an element; the inspector card shows size, position, spacing, radius, layout, font and colours (click a colour to copy it). With an element selected, hover another one to get red-line distances. `↑`/`↓` select the parent or first child, `Enter` comments on the selection. Drag to select a region. |
| Comment | `C` | Click to pin a comment to the element under the cursor, or drag to comment on a region. Each thread has a type (change request, decision, question, note), replies, resolve/reopen and delete. Pins can be dragged. |
| Draw | `D` | Pen `P`, line `L`, arrow `A`, rectangle `R`, ellipse `O`, text `T` and eraser `E`. Colour palette or a custom colour, four stroke widths, dashed strokes. `Shift` snaps lines to 45° and shapes to squares. In Inspect mode, click a drawing to select it, drag or use the arrow keys to move it, and `⌫` to delete it. |
| Rulers & guides | `M` | Rulers along the top and left edges in page coordinates. They highlight the hovered or selected element. Drag from a ruler to add a guide (it snaps to element edges; hold `⌥` to turn snapping off). Drag a guide back onto the ruler, or double-click it, to remove it. |
| Layout grid | `G` | Column overlay with stretch or fixed columns and adjustable count, width, margin, gutter, colour and opacity. Drag a field's label to scrub its value. Settings are remembered per site. |
| Feedback | `F` | Every thread on the page, filterable by open or resolved. Click a thread to scroll to it. |
| Export for AI | `⇧E` | Add an optional brief, then download the handoff HTML. |
| Undo / redo | `⌘Z` / `⇧⌘Z` | Applies to every document change: comments, drawings, guides, moves and deletes. |
| Pause | `Esc` | Steps back one level each press: closes popovers and panels, deselects, returns to Inspect, then pauses the tools so you can use the page normally. |
| Open / close | `⌥⇧D` | Toggles the toolbar on the current tab. You can change the shortcut at `chrome://extensions/shortcuts`. |

Annotations are saved in extension storage (`chrome.storage.local`) per page URL, so you can close the toolbar and come back later. Nothing is written to the site itself. The only page modification is the toolbar's own shadow-DOM host element, and closing the toolbar removes it.

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
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin **Chrome Design**, open any http(s) page, then click the icon → **Toggle toolbar** (or press `⌥⇧D`).
5. Optional: tick **Embed assets from other sites** in the popup. It requests `<all_urls>` at runtime so exports can inline CDN images, fonts and stylesheets that don't send CORS headers. Without it, those assets are listed as warnings in the export.
6. Optional: enable **Allow access to file URLs** on the extension's details page to use it on local `file://` pages.

After changing code, run `pnpm build` again and click the reload icon on the extension card. `pnpm dev` rebuilds on save (watch mode).

### Scripts

| Command | Purpose |
| --- | --- |
| `pnpm build` | Production build into `dist/` |
| `pnpm dev` | Watch build into `dist/` |
| `pnpm demo` | Runs the real in-page UI on a sample site at http://127.0.0.1:5173. There is no extension runtime there, so screenshots are skipped and annotations go to `localStorage`. |
| `pnpm demo:build` | Static build of the demo into `demo-dist/` |
| `pnpm typecheck` | `tsc --noEmit` (TypeScript 7) |
| `pnpm lint` | Oxlint + Biome check |
| `pnpm lint:fix` / `pnpm format` | Auto-fix / format |
| `pnpm test` | Vitest unit tests (schema/export, sanitizer, CSS rewriting, geometry, store history, shortcuts, selectors) |
| `pnpm e2e:install` | One-time project-local Chromium download for e2e (`PLAYWRIGHT_BROWSERS_PATH=0`, stored in `node_modules`) |
| `pnpm test:e2e` | Builds `dist-e2e/` and runs Playwright against the real unpacked extension. It injects the toolbar, comments, inspects, draws, undoes and redoes, exports, then opens the export offline and asserts zero network requests. |
| `pnpm check` | typecheck + lint + unit tests + build |

`dist-e2e/` is a test-only build that adds `<all_urls>` host access, because automated tests can't click the toolbar icon to grant `activeTab`. Don't load it for real use.

## Architecture

```
src/
  shared/      typed models (model.ts), JSON Schema (schema.ts), escaping, geometry, measurement, messages
  background/  service worker: ⌥⇧D command, captureVisibleTab, optional asset fetch; inject.ts (restricted-page checks + on-demand injection)
  popup/       React popup: status for this tab, toggle button, optional host-permission switch
  content/     content script (IIFE, injected on demand) with React UI in a shadow root
    store.ts        editor state + undo/redo history (external store, framework-free)
    overlay/        capture layer (pointer logic), page-space annotation layer, inspector, rulers/guides/grid
    ui/             toolbar, drawing bar, panels (grid, feedback, export, help)
    exporter.ts     capture → build → download
  capture/     DOM → sanitized snapshot: stylesheets (CSSOM, @import, adopted sheets, shadow roots),
               asset embedding with byte budget, viewport-unit rewriting, element anchors/selectors
  export/      pure document builder (build.ts), agent prompt, SVG overlay, self-contained viewer runtime
demo/          sample site + harness for the in-page UI (also the phone preview)
tests/         Vitest unit tests; tests/e2e Playwright extension tests
scripts/       build.mjs (three Vite builds + manifest), make-icons.mjs (dependency-free PNG icons)
```

- **Permissions:** `activeTab`, `scripting` and `storage`, plus the optional `<all_urls>` that the popup requests only when you tick the switch. There are no static content scripts and no host permissions by default.
- **Messages:** only the content script talks to the service worker, to ask for a screenshot or an asset fetch. The service worker checks that the sender is this extension.
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
- Pages that scroll an inner container instead of the window keep annotations in document coordinates, so pins won't follow that inner scroll.
- Very large pages are capped at an 80 MB embed budget (8 MB per asset). Anything over the cap is listed as a warning.

## Attribution

Chrome Design is an original implementation inspired by the workflow in [Squints](https://x.com/andreaskatzmann/status/2109119904351924379) by Andreas Katzmann: design inspection tools (inspect, rulers and guides, column grid, drawing) layered over live web pages. I studied the public demo video and the public feature description. No Squints source code, branding, logos, icons or assets were used. The interface, icon set, extension icon, code and the AI-handoff export format are original to this project.

## License

Private, for personal use (`UNLICENSED`).
