/* Baut aus index.html, styles.css und app.js eine einzelne HTML-Datei.
 *
 *   node build-single.mjs                     -> dist/kontenmodell.html
 *   node build-single.mjs --body-only --out X -> ohne <html>/<head>/<body>,
 *                                                für Umgebungen, die den
 *                                                Seitenrahmen selbst stellen
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const bodyOnly = args.includes('--body-only');
const outArg = args.indexOf('--out');
const outPath = resolve(
  root,
  outArg !== -1 ? args[outArg + 1] : 'dist/kontenmodell.html',
);

const [html, css, js] = await Promise.all(
  ['index.html', 'styles.css', 'app.js'].map((name) =>
    readFile(resolve(root, name), 'utf8'),
  ),
);

/* Ersetzungen als Funktion, damit $-Zeichen im Quelltext nicht als
   Rückverweise interpretiert werden. */
let out = html
  .replace(/\s*<link rel="stylesheet" href="styles\.css">/, () => `\n  <style>\n${css}\n  </style>`)
  .replace(/\s*<script src="app\.js"><\/script>/, () => `\n  <script>\n${js}\n  </script>`);

if (bodyOnly) {
  const title = out.match(/<title>(.*?)<\/title>/s)?.[1] ?? 'Kontenmodell';
  const style = out.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? '';
  const body = out.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';
  out = `<title>${title}</title>\n${style}\n${body}`;
}

for (const marker of ['styles.css', 'app.js']) {
  if (out.includes(`"${marker}"`)) throw new Error(`${marker} wurde nicht eingebettet`);
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, out);
console.log(`${outPath} – ${(out.length / 1024).toFixed(1)} kB`);
