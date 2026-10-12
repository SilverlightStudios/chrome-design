import { useEffect, useRef, useState } from 'react';
import { useEditor, useEnv } from '../context';
import { toPage } from '../dom';
import { dragHasFiles, imageFiles, loadImageFiles, placeImages, viewportCentre } from '../images';
import { Icon } from '../ui/icons';

/** Anything marked `data-drop-attach` (the comment bubble) takes dropped images itself. */
function overAttachTarget(e: Event): boolean {
  return e.composedPath().some((n) => n instanceof Element && n.hasAttribute('data-drop-attach'));
}

function isTypingTarget(e: Event): boolean {
  const t = e.composedPath()[0];
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.localName === 'textarea' || t.localName === 'input')
  );
}

/**
 * The page as a canvas: while a tool is on, images dragged in from the desktop or another
 * tab land where they're dropped, and an image pasted with ⌘V lands in the middle of the
 * screen. Paused, the page gets its drops and pastes as usual.
 */
export function ImageDrop() {
  const { store, toast } = useEnv();
  const active = useEditor((s) => s.tool !== 'browse');
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!active) return;
    let timer = 0;
    // A drag that leaves the window (or is cancelled) stops sending dragover; hide shortly after.
    const onOver = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      if (overAttachTarget(e)) {
        setOver(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setOver(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOver(false), 160);
    };
    const place = (files: File[], at: { x: number; y: number }) => {
      if (files.length === 0) {
        toast('Only images can be placed on the page');
        return;
      }
      void loadImageFiles(files).then((images) => {
        if (images.length) placeImages(store, images, at);
        else toast('That image couldn’t be opened');
      });
    };
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer) || overAttachTarget(e)) return;
      e.preventDefault();
      e.stopPropagation();
      window.clearTimeout(timer);
      setOver(false);
      place(imageFiles(e.dataTransfer), toPage(e.clientX, e.clientY));
    };
    const onPaste = (e: ClipboardEvent) => {
      // Text fields handle their own paste (the comment box attaches images).
      if (isTypingTarget(e)) return;
      const files = imageFiles(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      place(files, viewportCentre());
    };
    window.addEventListener('dragenter', onOver, true);
    window.addEventListener('dragover', onOver, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.clearTimeout(timer);
      setOver(false);
      window.removeEventListener('dragenter', onOver, true);
      window.removeEventListener('dragover', onOver, true);
      window.removeEventListener('drop', onDrop, true);
      window.removeEventListener('paste', onPaste, true);
    };
  }, [active, store, toast]);

  return over ? <div className="drop-zone" aria-hidden="true" /> : null;
}

/** A comment's attached image, full size over everything. Tap anywhere or Esc to close. */
export function ImageViewer() {
  const { store } = useEnv();
  const image = useEditor((s) => s.viewImage);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (image) closeRef.current?.focus({ preventScroll: true });
  }, [image]);
  if (!image) return null;
  const close = () => store.set({ viewImage: null });
  return (
    <div
      className="lightbox ui"
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <img src={image.src} alt={image.name} width={image.width} height={image.height} />
      <button ref={closeRef} type="button" className="lightbox-close" aria-label="Close">
        <Icon.close />
      </button>
    </div>
  );
}
