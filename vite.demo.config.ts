import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';

const root = import.meta.dirname;

/** The content script as one IIFE — what exported files build in so they open with the toolbar. */
async function buildRuntime(): Promise<string> {
  // Vite reads NODE_ENV to decide production mode (and plugin-react its JSX runtime); the dev
  // server has set it to development, so switch it for this build only.
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return await buildIife();
  } finally {
    process.env.NODE_ENV = env;
  }
}

async function buildIife(): Promise<string> {
  const result = await build({
    root,
    // Production JSX and React even when this runs inside the dev server.
    mode: 'production',
    configFile: false,
    logLevel: 'warn',
    plugins: [react()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      minify: true,
      target: 'chrome120',
      lib: {
        entry: resolve(root, 'src/content/index.ts'),
        formats: ['iife'],
        name: 'ChromeDesignContent',
        fileName: () => 'chrome-design.js',
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const out of outputs) {
    if (!('output' in out)) continue;
    const chunk = out.output.find((o) => o.type === 'chunk');
    if (chunk && chunk.type === 'chunk') return chunk.code;
  }
  throw new Error('runtime build produced no chunk');
}

/** Serves `/chrome-design.js` in dev (rebuilt per request) and emits it in demo:build. */
function chromeDesignRuntime(): Plugin {
  return {
    name: 'chrome-design-runtime',
    configureServer(server) {
      server.middlewares.use('/chrome-design.js', (_req, res) => {
        buildRuntime().then(
          (code) => {
            res.setHeader('content-type', 'text/javascript; charset=utf-8');
            res.end(code);
          },
          (error: unknown) => {
            res.statusCode = 500;
            res.end(String(error));
          },
        );
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'chrome-design.js', source: await buildRuntime() });
    },
  };
}

/** Demo page: the real in-page UI on a sample site (`pnpm demo`), also built to demo-dist/. */
export default defineConfig({
  root: 'demo',
  base: './',
  plugins: [react(), chromeDesignRuntime()],
  build: { outDir: '../demo-dist', emptyOutDir: true, target: 'es2022' },
  server: { host: '127.0.0.1' },
});
