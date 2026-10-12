// Demo harness: runs the real content-script UI on a sample page without the extension.
// Screenshots and cross-origin asset fetches need the extension and are skipped here.
import '../src/content/index';

void window.__chromeDesign?.open();

const reopen = document.createElement('button');
reopen.textContent = 'Open Chrome Design';
reopen.style.cssText =
  'position:fixed;right:16px;bottom:16px;z-index:5;padding:10px 14px;border-radius:10px;border:0;background:#18191c;color:#fff;font:600 13px system-ui;cursor:pointer';
reopen.addEventListener('click', () => void window.__chromeDesign?.open());
document.body.appendChild(reopen);
