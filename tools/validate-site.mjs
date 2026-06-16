import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const siteRoot = path.join(repositoryRoot, 'site');

function requireFile(relativePath) {
  const absolutePath = path.join(siteRoot, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Missing site file: ${relativePath}`);
  return absolutePath;
}

for (const relativePath of [
  'index.html',
  'app.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'data/Item.json',
  'data/tips.json',
  'assets/app-icons/favicon.png',
  'assets/app-icons/icon-192.png',
  'assets/app-icons/icon-512.png'
]) {
  requireFile(relativePath);
}

const items = JSON.parse(fs.readFileSync(requireFile('data/Item.json'), 'utf8'));
JSON.parse(fs.readFileSync(requireFile('data/tips.json'), 'utf8'));
JSON.parse(fs.readFileSync(requireFile('manifest.webmanifest'), 'utf8'));

const missingIcons = [];
for (const item of items) {
  if (!item.IconFile) continue;
  const relativePath = path.join('assets', 'item-icons', item.IconFile.slice(0, 3), item.IconFile);
  if (!fs.existsSync(path.join(siteRoot, relativePath))) missingIcons.push(relativePath);
}

const iconErrorLog = path.join(repositoryRoot, 'pipeline', 'logs', 'icon-download-errors.txt');
const knownMissingIcons = new Set(
  fs.readFileSync(iconErrorLog, 'utf8')
    .split(/\r?\n/)
    .map(line => path.basename(line.trim()))
    .filter(Boolean)
);
const unexpectedMissingIcons = missingIcons.filter(relativePath => {
  return !knownMissingIcons.has(path.basename(relativePath));
});

if (unexpectedMissingIcons.length > 0) {
  throw new Error(
    `Missing ${unexpectedMissingIcons.length} unlogged item icons. First: ${unexpectedMissingIcons[0]}`
  );
}

const powershellFiles = [];
for (const directory of ['pipeline/scripts', 'tools/repository', 'tools/setup']) {
  const absoluteDirectory = path.join(repositoryRoot, directory);
  for (const name of fs.readdirSync(absoluteDirectory)) {
    if (name.endsWith('.ps1')) powershellFiles.push(path.join(absoluteDirectory, name));
  }
}

const invalidBomFiles = powershellFiles.filter(file => {
  const bytes = fs.readFileSync(file);
  return bytes.length < 3 || bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf;
});

if (invalidBomFiles.length > 0) {
  throw new Error(`PowerShell files without UTF-8 BOM: ${invalidBomFiles.join(', ')}`);
}

console.log(
  `Validated ${items.length} items and ${powershellFiles.length} PowerShell files. ` +
  `${missingIcons.length} known icon download failures are recorded.`
);
