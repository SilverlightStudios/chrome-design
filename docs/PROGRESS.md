# Build progress (resumable notes)

## Status (2026-10-12)
Round 3 done: Figma-like, plain-language UI for non-technical designers and a mobile pass. All checks
pass: typecheck, Oxlint, Biome, 67 unit tests, 8 Playwright e2e tests against the real unpacked
extension (including a phone-width bottom-sheet test). Verified on the demo page in desktop Chromium
(DevTools motion measurements) and the iPhone 15 WebKit emulator (touch).

## Rounds
- R1: the extension, capture/sanitize, one-file AI handoff export.
- R2: Remote Desktop look (Liquid Glass toolbar), Spark motion (morphing tooltip, spring sheets),
  one-click toggle, welcome/settings page, host integration (top layer, modal dialogs, CSP, SPA).
- R3: one-row toolbar (Close · Select · Comment · Pencil · Shapes · Text · More · Send to AI);
  direct manipulation of drawings (move, resize handles, edit labels, auto-return to Select);
  plain-language element names (`src/content/describe.ts`) + floating selection bar + Details;
  comment bubble with send button; More sheet of tiles; contextual style bar; phone bottom sheets on
  the Remote Desktop drawer physics; exit animations everywhere (bubble, bars, sheets, whole UI).
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
- Export fidelity leftovers from R2: open the viewer at the captured viewport with an outline, `image-set()` URLs, recursive capture of same-origin iframes.
- Live style/text “edit” proposals applied to the page (recorded as structured edits).
- Dragging a phone sheet from its list when scrolled to the top (only the handle and title row drag today).
