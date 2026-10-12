/**
 * Runtime for the exported handoff file. Embedded verbatim via `viewerRuntime.toString()`,
 * so it must be fully self-contained: no imports, no references to module scope.
 * It never makes network requests (the document CSP forbids them anyway).
 */
export function viewerRuntime(): void {
  const doc = document;
  const $ = <T extends Element>(sel: string, root: ParentNode = doc): T | null =>
    root.querySelector<T>(sel);
  const $$ = <T extends Element>(sel: string, root: ParentNode = doc): T[] =>
    Array.from(root.querySelectorAll<T>(sel));

  interface PinPoint {
    x: number;
    y: number;
  }
  interface ThreadLike {
    id: string;
    type: string;
    number: number;
    target: {
      type: string;
      point?: PinPoint;
      rect?: { x: number; y: number; width: number; height: number };
      anchor?: { ref?: string };
      anchors?: { ref?: string }[];
    };
  }
  interface PayloadLike {
    page: {
      viewport: { width: number; height: number };
      document: { width: number; height: number };
    };
    annotations: ThreadLike[];
  }

  const payloadEl = doc.getElementById('chrome-design-payload');
  const snapshotEl = doc.getElementById('chrome-design-snapshot');
  if (!payloadEl || !snapshotEl) return;
  const payload = JSON.parse(payloadEl.textContent || '{}') as PayloadLike;
  const snapshotHtml = (snapshotEl.textContent || '').replace(/<(\\*)\\(\/?script|!--)/gi, '<$1$2');

  const stage = $<HTMLElement>('[data-cd-stage]');
  const canvas = $<HTMLElement>('[data-cd-canvas]');
  const frame = $<HTMLIFrameElement>('[data-cd-frame]');
  const zoomLabel = $<HTMLElement>('[data-cd-zoom-label]');
  if (!stage || !canvas || !frame) return;
  doc.documentElement.classList.add('cd-js');

  const pageW = Math.max(1, payload.page.viewport.width);
  const pageH = Math.max(1, payload.page.document.height);

  // ---- snapshot mount -------------------------------------------------------
  frame.addEventListener('load', () => {
    const fdoc = frame.contentDocument;
    if (!fdoc) return;
    for (const el of Array.from(fdoc.querySelectorAll<HTMLElement>('[data-cd-scroll]'))) {
      const [top, left] = (el.getAttribute('data-cd-scroll') || '0,0').split(',').map(Number);
      el.scrollTop = top || 0;
      el.scrollLeft = left || 0;
    }
    const style = fdoc.createElement('style');
    style.setAttribute('data-cd-viewer', '');
    style.textContent =
      '[data-cd-highlight]{outline:3px solid #2563EB!important;outline-offset:2px!important;box-shadow:0 0 0 6px rgba(37,99,235,.2)!important}';
    fdoc.head?.appendChild(style);
  });
  frame.srcdoc = snapshotHtml;

  // ---- zoom / pan -----------------------------------------------------------
  let scale = 1;
  let tx = 0;
  let ty = 0;
  const clampScale = (s: number) => Math.min(4, Math.max(0.1, s));
  const apply = () => {
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  };
  const zoomAt = (next: number, cx: number, cy: number) => {
    const s = clampScale(next);
    tx = cx - ((cx - tx) * s) / scale;
    ty = cy - ((cy - ty) * s) / scale;
    scale = s;
    apply();
  };
  const fitToWidth = () => {
    const w = stage.clientWidth;
    scale = clampScale(Math.min(1, (w - 32) / pageW));
    tx = Math.max(16, (w - pageW * scale) / 2);
    ty = 16;
    apply();
  };
  const actual = () => {
    scale = 1;
    tx = Math.max(16, (stage.clientWidth - pageW) / 2);
    ty = 16;
    apply();
  };
  canvas.style.width = `${pageW}px`;
  canvas.style.height = `${pageH}px`;
  fitToWidth();
  let userZoomed = false;
  new ResizeObserver(() => {
    if (!userZoomed) fitToWidth();
  }).observe(stage);

  const center = () => ({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
  const onAction = (action: string) => {
    userZoomed = action !== 'fit';
    const c = center();
    if (action === 'zoom-in') zoomAt(scale * 1.25, c.x, c.y);
    else if (action === 'zoom-out') zoomAt(scale / 1.25, c.x, c.y);
    else if (action === 'fit') fitToWidth();
    else if (action === 'actual') actual();
  };
  for (const btn of $$<HTMLButtonElement>('[data-cd-action]')) {
    btn.addEventListener('click', () => onAction(btn.dataset.cdAction || ''));
  }

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      userZoomed = true;
      const rect = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(scale * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        tx -= e.deltaX;
        ty -= e.deltaY;
        apply();
      }
    },
    { passive: false },
  );

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { dist: number; scale: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.cd-pin, button, a')) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.classList.add('is-panning');
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinchStart = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    userZoomed = true;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = Array.from(pointers.values());
      const rect = stage.getBoundingClientRect();
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      zoomAt(
        (pinchStart.scale * dist) / pinchStart.dist,
        (a!.x + b!.x) / 2 - rect.left,
        (a!.y + b!.y) / 2 - rect.top,
      );
      return;
    }
    tx += e.clientX - prev.x;
    ty += e.clientY - prev.y;
    apply();
  });
  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) stage.classList.remove('is-panning');
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  stage.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') onAction('zoom-in');
    else if (e.key === '-') onAction('zoom-out');
    else if (e.key === '0') onAction('fit');
    else if (e.key === '1') onAction('actual');
    else return;
    e.preventDefault();
  });

  // ---- layer toggles --------------------------------------------------------
  for (const input of $$<HTMLInputElement>('[data-cd-toggle]')) {
    const update = () =>
      doc.documentElement.classList.toggle(`cd-hide-${input.dataset.cdToggle}`, !input.checked);
    input.addEventListener('change', update);
    update();
  }

  // ---- linking list <-> pins -------------------------------------------------
  const byId = new Map(payload.annotations.map((a) => [a.id, a]));
  const pointOf = (a: ThreadLike): PinPoint | null => {
    if (a.target.type === 'region' && a.target.rect)
      return { x: a.target.rect.x, y: a.target.rect.y };
    return a.target.point ?? null;
  };
  const refsOf = (a: ThreadLike): string[] => {
    const refs: string[] = [];
    if (a.target.anchor?.ref) refs.push(a.target.anchor.ref);
    for (const anc of a.target.anchors || []) if (anc.ref) refs.push(anc.ref);
    return refs;
  };
  const highlight = (id: string) => {
    for (const el of $$('.is-active')) el.classList.remove('is-active');
    for (const el of $$(`[data-annotation-id="${CSS.escape(id)}"]`)) el.classList.add('is-active');
    const fdoc = frame.contentDocument;
    if (fdoc) {
      for (const el of Array.from(fdoc.querySelectorAll('[data-cd-highlight]')))
        el.removeAttribute('data-cd-highlight');
      const a = byId.get(id);
      if (a) {
        for (const ref of refsOf(a)) {
          fdoc
            .querySelector(`[data-cd-ref="${CSS.escape(ref)}"]`)
            ?.setAttribute('data-cd-highlight', '');
        }
      }
    }
  };
  const focusOnCanvas = (id: string) => {
    const a = byId.get(id);
    if (!a) return;
    const p = pointOf(a);
    highlight(id);
    if (!p) return;
    if (scale < 0.5) scale = 0.75;
    userZoomed = true;
    tx = stage.clientWidth / 2 - p.x * scale;
    ty = stage.clientHeight / 2 - p.y * scale;
    apply();
    stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  for (const item of $$<HTMLElement>('[data-cd-change]')) {
    const id = item.dataset.annotationId || '';
    item.addEventListener('click', (e) => {
      if ((e.target as Element).closest('a, summary, details[open] *')) return;
      focusOnCanvas(id);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        focusOnCanvas(id);
      }
    });
  }
  const activatePin = (pin: Element) => {
    const id = pin.getAttribute('data-annotation-id') || '';
    highlight(id);
    const item = doc.getElementById(`change-${pin.getAttribute('data-number')}`);
    item?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  for (const pin of $$('.cd-pin')) {
    pin.addEventListener('click', () => activatePin(pin));
    pin.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') activatePin(pin);
    });
  }

  // ---- utilities ---------------------------------------------------------------
  const copyBtn = $<HTMLButtonElement>('[data-cd-copy-prompt]');
  copyBtn?.addEventListener('click', async () => {
    const text = $('#agent-prompt-text')?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
    } catch {
      const range = doc.createRange();
      const node = $('#agent-prompt-text');
      if (node) {
        range.selectNodeContents(node);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      }
      copyBtn.textContent = 'Selected — press ⌘C';
    }
    setTimeout(() => {
      copyBtn.textContent = 'Copy prompt';
    }, 1800);
  });

  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('[data-cd-download="payload"]')?.addEventListener('click', () =>
    download('chrome-design-payload.json', JSON.stringify(payload, null, 2), 'application/json'),
  );
  $('[data-cd-download="snapshot"]')?.addEventListener('click', () =>
    download('snapshot.html', snapshotHtml, 'text/html'),
  );
}
