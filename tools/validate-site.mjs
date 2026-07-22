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
  'calculation.js',
  'app.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'data/Item.json',
  'data/tips.md',
  'assets/app-icons/favicon.png',
  'assets/app-icons/icon-192.png',
  'assets/app-icons/icon-512.png',
  'assets/job-icons/alchemist.webp',
  'assets/job-icons/armorer.webp',
  'assets/job-icons/blacksmith.webp',
  'assets/job-icons/botanist.webp',
  'assets/job-icons/carpenter.webp',
  'assets/job-icons/culinarian.webp',
  'assets/job-icons/fisher.webp',
  'assets/job-icons/goldsmith.webp',
  'assets/job-icons/leatherworker.webp',
  'assets/job-icons/miner.webp',
  'assets/job-icons/weaver.webp'
]) {
  requireFile(relativePath);
}

const items = JSON.parse(fs.readFileSync(requireFile('data/Item.json'), 'utf8'));
fs.readFileSync(requireFile('data/tips.md'), 'utf8');
JSON.parse(fs.readFileSync(requireFile('manifest.webmanifest'), 'utf8'));

const missingIcons = [];
const invalidEquipmentPerformance = [];
for (const item of items) {
  if (item.EquipmentInfo) {
    const performance = item.EquipmentInfo.performance;
    const physicalDamage = Number(performance?.physicalDamage || 0);
    const magicalDamage = Number(performance?.magicalDamage || 0);
    if (!performance || (physicalDamage > 0 && magicalDamage > 0)) {
      invalidEquipmentPerformance.push(item.Name || item.ID);
    }
  }
  if (!item.IconFile) continue;
  const relativePath = path.join('assets', 'item-icons', item.IconFile.slice(0, 3), item.IconFile);
  if (!fs.existsSync(path.join(siteRoot, relativePath))) missingIcons.push(relativePath);
}

if (invalidEquipmentPerformance.length > 0) {
  throw new Error(
    `Invalid equipment performance data: ${invalidEquipmentPerformance.slice(0, 10).join(', ')}`
  );
}

if (missingIcons.length > 0) {
  console.warn(
    `Warning: ${missingIcons.length} item icon files are missing. First: ${missingIcons[0]}`
  );
}

const powershellFiles = [];
for (const directory of ['pipeline/scripts', 'tools/repository', 'tools/setup']) {
  const absoluteDirectory = path.join(repositoryRoot, directory);
  if (!fs.existsSync(absoluteDirectory)) continue;
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
  `${missingIcons.length} missing item icons are allowed.`
);
