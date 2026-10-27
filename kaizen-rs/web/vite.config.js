import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

// Write .br/.gz next to each text asset so the Rust server can serve them
// precompressed (no per-request compression cost).
function precompress() {
  return {
    name: 'kaizen-precompress',
    apply: 'build',
    closeBundle() {
      const walk = (dir) => readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
      for (const file of walk('dist')) {
        if (!/\.(js|css|html|svg|json|txt|webmanifest)$/.test(file)) continue;
        const source = readFileSync(file);
        if (source.length < 1024) continue;
        writeFileSync(`${file}.br`, brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${file}.gz`, gzipSync(source, { level: 9 }));
      }
    },
  };
}

const api = process.env.KAIZEN_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [solid(), tailwindcss(), precompress()],
  server: {
    proxy: {
      '/api': { target: api, ws: true },
      '/auth': api,
      '/healthz': api,
    },
  },
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
  },
});
