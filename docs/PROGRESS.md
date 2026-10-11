# Build progress (resumable notes)

Working notes so an interrupted session can pick up where it left off.

## Architecture decisions
- Content script = single IIFE (`dist/content.js`) injected on demand via `chrome.scripting` (activeTab). UI is React inside an open Shadow DOM host `<chrome-design-root>` appended to `<html>`; removed entirely on close.
- Page-space annotation layer: absolutely positioned 0×0 container at document origin (scrolls natively). Toolbar/rulers/grid use fixed positioning.
- Service worker: injection, `captureVisibleTab`, optional cross-origin asset fetch (only with optional `<all_urls>` permission granted from the popup).
- Export: `src/export/build.ts` is pure (testable in Node). Snapshot stored raw in `<script type="text/html" id="chrome-design-snapshot">` (escaping in `src/shared/escape.ts`), payload in `application/json`, JSON Schema in `application/schema+json`, source DOM as JSON string. Viewer runtime is one self-contained function embedded with `fn.toString()`; CSP `default-src 'none'` + script hash; snapshot iframe `sandbox="allow-same-origin"` (no scripts).
- vh/dvh/svh/lvh units are rewritten to px in the snapshot so `100vh` sections keep their size inside a full-height iframe.

## Status
See git log on branch `smoliv/chrome-design-recreate-page-annotation-e-2b03`.
