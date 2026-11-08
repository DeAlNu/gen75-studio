import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export const WORKER_NAME = 'sw.js';
export const TEMPLATE_PATH = fileURLToPath(new URL('./sw.template.js', import.meta.url));

const VERSION_MARK = "'__VERSION__'";
const FILES_MARK = '__FILES__';

/** Daftar berkas hasil build (jalur relatif dengan garis miring), tanpa service worker dan peta sumber. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const rel = relative(dir, full).split(sep).join('/');
      if (rel === WORKER_NAME || rel.endsWith('.map')) continue;
      out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

/** Sidik jari isi seluruh berkas; berubah bila ada satu byte saja yang berbeda. Tidak bergantung pada urutan. */
export function fingerprint(entries: { path: string; bytes: Uint8Array }[]): string {
  const lines = entries
    .map((e) => `${e.path}:${createHash('sha256').update(e.bytes).digest('hex')}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(lines).digest('hex').slice(0, 16);
}

export function renderWorker(template: string, version: string, files: string[]): string {
  if (!template.includes(VERSION_MARK) || !template.includes(FILES_MARK)) {
    throw new Error('Templat service worker tidak memuat penanda VERSION atau FILES.');
  }
  return template.replace(VERSION_MARK, () => JSON.stringify(version)).replace(FILES_MARK, () => JSON.stringify(files, null, 2));
}

/** Menulis dist/sw.js berisi daftar berkas dan versi dari isi build. Hanya aktif pada build produksi. */
export function pwaPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'gen75-pwa',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const files = listFiles(outDir);
      if (!files.includes('index.html')) throw new Error('index.html tidak ada di hasil build; service worker tidak dibuat.');
      const template = readFileSync(TEMPLATE_PATH, 'utf8');
      // Templat ikut dihitung: mengubah logika worker juga menghasilkan versi cache baru.
      const entries = files.map((path) => ({ path, bytes: readFileSync(join(outDir, path)) }));
      entries.push({ path: `${WORKER_NAME}.template`, bytes: Buffer.from(template, 'utf8') });
      writeFileSync(join(outDir, WORKER_NAME), renderWorker(template, fingerprint(entries), files));
    },
  };
}
