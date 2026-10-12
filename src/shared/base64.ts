/** Chunked ArrayBuffer → base64 (works in service workers, which lack FileReader). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function toDataUrl(buffer: ArrayBuffer, mime: string): string {
  return `data:${mime || 'application/octet-stream'};base64,${arrayBufferToBase64(buffer)}`;
}

/** Best-effort MIME type from the response header or URL extension. */
export function guessMime(url: string, header: string | null): string {
  const fromHeader = header?.split(';')[0]?.trim().toLowerCase();
  if (
    fromHeader &&
    fromHeader !== 'application/octet-stream' &&
    fromHeader !== 'binary/octet-stream'
  ) {
    return fromHeader;
  }
  const ext = url.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/ttf',
    otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
    css: 'text/css',
  };
  return map[ext] ?? fromHeader ?? 'application/octet-stream';
}
