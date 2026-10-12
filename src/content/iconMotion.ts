/**
 * Plays the animated icons (ui/icons.tsx): pressing a control replays its icon's animation,
 * and a mouse entering one plays it once. Icons marked `data-hold` keep a pose while hovered
 * (pure CSS), so the mouse only plays them on press. The animation itself is CSS keyframes
 * keyed off `data-play`; this just restarts it.
 */
const CONTROL = 'button, label, [role="button"], [role="radio"], [role="switch"]';

function iconIn(target: EventTarget | null): { control: Element; svg: SVGElement } | null {
  const control = (target as Element | null)?.closest?.(CONTROL);
  if (!control || control.matches(':disabled, [aria-disabled="true"]')) return null;
  const svg = control.querySelector<SVGElement>('svg.ai');
  return svg ? { control, svg } : null;
}

export function playIcon(svg: SVGElement): void {
  svg.removeAttribute('data-play');
  // Restart the keyframes from the top even if they are still running.
  void svg.getBoundingClientRect();
  svg.setAttribute('data-play', '');
}

function onOver(e: PointerEvent): void {
  if (e.pointerType !== 'mouse') return;
  const hit = iconIn(e.target);
  if (!hit || hit.svg.hasAttribute('data-hold')) return;
  // Only on entering the control, not when moving between its children.
  if (e.relatedTarget instanceof Node && hit.control.contains(e.relatedTarget)) return;
  playIcon(hit.svg);
}

function onDown(e: PointerEvent): void {
  if (e.button > 0) return;
  const hit = iconIn(e.target);
  if (hit) playIcon(hit.svg);
}

export function installIconMotion(root: HTMLElement): () => void {
  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerdown', onDown);
  return () => {
    root.removeEventListener('pointerover', onOver);
    root.removeEventListener('pointerdown', onDown);
  };
}
