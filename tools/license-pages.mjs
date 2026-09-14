import fs from 'node:fs';
import path from 'node:path';

const style = `
* { box-sizing: border-box; }
html { color-scheme: light dark; background: Canvas; color: CanvasText; }
body { max-width: 76rem; margin: 0 auto; padding: 20px; font: 1rem/1.7 system-ui, sans-serif; }
h1 { font-size: 1.5rem; line-height: 1.4; }
h2 { font-size: 1.25rem; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
a, code, summary, h1, h2, h3 { overflow-wrap: anywhere; }
details, div { min-width: 0; max-width: 100%; }
summary { cursor: pointer; padding: 8px 0; }
@media (max-width: 600px) { body { padding: 16px; } ul { padding-left: 24px; } }
`;

export const licensePages = [
  ['xivca-MIT-LICENSE', 'XIVca — MIT ライセンス'],
  ['marked-LICENSE', 'marked — MIT ライセンス'],
  ['dompurify-Apache-2.0-LICENSE', 'DOMPurify — Apache ライセンス 2.0'],
  ['html2canvas-MIT-LICENSE', 'html2canvas — MIT ライセンス'],
  ['swiper-MIT-LICENSE', 'Swiper — MIT ライセンス'],
  ['raphael-Apache-2.0-LICENSE', 'Raphael — Apache ライセンス 2.0'],
  ['third-party-NOTICES', '第三者ソフトウェアのライセンス・権利表記']
];

const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function renderLicensePage(text, title) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${style}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<pre>${escapeHtml(text.replaceAll('\r\n', '\n'))}</pre>
</main>
</body>
</html>
`;
}

export function renderRustLicensePage(original) {
  const source = original.replace(/<meta name="viewport"[^>]*>\r?\n<!-- XIVca: mobile layout only; upstream license text is unchanged\. -->\r?\n<style>[\s\S]*?<\/style>\r?\n/u, '');
  return source.replace('<html>', '<html lang="en">').replace('</head>', `<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- XIVca: mobile layout only; upstream license text is unchanged. -->
<style>${style}</style>
</head>`);
}

export function validateLicensePages(repositoryRoot) {
  const dir = path.join(repositoryRoot, 'site/vendor/licenses');
  for (const [name, title] of licensePages) {
    const expected = renderLicensePage(fs.readFileSync(path.join(dir, name + '.txt'), 'utf8'), title);
    const actual = fs.readFileSync(path.join(dir, name + '.html'), 'utf8').replaceAll('\r\n', '\n');
    if (actual !== expected) throw new Error(`ライセンス表示用HTMLと原文が一致しません: ${name}`);
  }
  const rust = fs.readFileSync(path.join(dir, 'rust-COPYRIGHT-library.html'), 'utf8');
  if (renderRustLicensePage(rust) !== rust) throw new Error('Rustのライセンス文書の表示設定が一致しません。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const root = path.resolve(import.meta.dirname, '..');
  if (process.argv.includes('--write')) {
    for (const [name, title] of licensePages) {
      const dir = path.join(root, 'site/vendor/licenses');
      fs.writeFileSync(path.join(dir, name + '.html'), renderLicensePage(fs.readFileSync(path.join(dir, name + '.txt'), 'utf8'), title));
    }
    const rust = path.join(root, 'site/vendor/licenses/rust-COPYRIGHT-library.html');
    fs.writeFileSync(rust, renderRustLicensePage(fs.readFileSync(rust, 'utf8')));
  }
  validateLicensePages(root);
}
