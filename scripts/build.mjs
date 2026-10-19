// Builds the unpacked MV3 extension into dist/:
//   popup.html (+assets)  content.js (IIFE, injected on demand)  background.js (module SW)
//   manifest.json  icons/
// Usage: node scripts/build.mjs [--watch] [--demo]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const e2e = process.argv.includes('--e2e');
// The e2e build lives in its own folder and adds <all_urls> host access so automated tests can
// inject without a user gesture (activeTab). Never load dist-e2e for real use.
const dist = resolve(root, e2e ? 'dist-e2e' : 'dist');
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const shared = {
  root,
  configFile: false,
  logLevel: 'warn',
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  build: {
    outDir: dist,
    emptyOutDir: false,
    sourcemap: watch ? 'inline' : false,
    minify: !watch,
    target: 'chrome120',
    watch: watch ? {} : null,
  },
};

function manifest() {
  return {
    manifest_version: 3,
    name: pkg.displayName,
    short_name: 'Chrome Design',
    version: pkg.version,
    description: pkg.description,
    minimum_chrome_version: '120',
    action: {
      default_title: 'Chrome Design (⌥⇧D)',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png' },
    },
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    background: { service_worker: 'background.js', type: 'module' },
    options_ui: { page: 'options.html', open_in_tab: true },
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'unlimitedStorage',
      // Tests drive the voice link without the permission prompt.
      ...(e2e ? ['nativeMessaging'] : []),
    ],
    optional_host_permissions: ['<all_urls>'],
    // The voice link (Settings → Voice recorder): talks to a local bridge, asked for when turned on.
    optional_permissions: ['nativeMessaging'],
    ...(e2e ? { host_permissions: ['<all_urls>'] } : {}),
    commands: {
      'toggle-chrome-design': {
        suggested_key: { default: 'Alt+Shift+D' },
        description: 'Open or close the Chrome Design toolbar on this tab',
      },
    },
  };
}

async function run() {
  if (!watch && existsSync(dist)) rmSync(dist, { recursive: true });
  mkdirSync(dist, { recursive: true });
  if (!existsSync(resolve(root, 'public/icons/icon-128.png'))) {
    await import('./make-icons.mjs');
  }
  cpSync(resolve(root, 'public'), dist, { recursive: true });
  writeFileSync(resolve(dist, 'manifest.json'), `${JSON.stringify(manifest(), null, 2)}\n`);

  await Promise.all([
    build({
      ...shared,
      build: {
        ...shared.build,
        rollupOptions: {
          input: {
            popup: resolve(root, 'src/popup/popup.html'),
            options: resolve(root, 'src/popup/options.html'),
          },
        },
      },
      // Emit popup.html at the dist root instead of dist/src/popup/.
      plugins: [
        ...shared.plugins,
        {
          name: 'flatten-popup-html',
          enforce: 'post',
          generateBundle(_options, bundle) {
            for (const file of Object.values(bundle)) {
              if (file.fileName.endsWith('popup.html')) file.fileName = 'popup.html';
              if (file.fileName.endsWith('options.html')) file.fileName = 'options.html';
            }
          },
        },
      ],
      base: './',
    }),
    build({
      ...shared,
      build: {
        ...shared.build,
        lib: {
          entry: resolve(root, 'src/content/index.ts'),
          formats: ['iife'],
          name: 'ChromeDesignContent',
          fileName: () => 'content.js',
        },
      },
    }),
    build({
      ...shared,
      build: {
        ...shared.build,
        lib: {
          entry: resolve(root, 'src/background/service-worker.ts'),
          formats: ['es'],
          fileName: () => 'background.js',
        },
      },
    }),
  ]);
  if (!watch)
    console.log(
      `Built ${pkg.displayName} ${pkg.version} → ${e2e ? 'dist-e2e/ (test build only)' : 'dist/ (chrome://extensions → Load unpacked)'}`,
    );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
