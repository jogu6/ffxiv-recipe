import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const siteRoot = path.join(repositoryRoot, 'site');
const applicationName = 'FinalFantasy XIV® Crafting Assistant XIVca(シヴカ)';
const applicationWindowTitle = 'XIVca | FinalFantasy XIV® Crafting Assistant';
const require = createRequire(import.meta.url);
const { extractAppVersion, extractReleaseMarkdown } = require('../site/pwa-update.js');

function requireFile(relativePath) {
  const absolutePath = path.join(siteRoot, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Missing site file: ${relativePath}`);
  return absolutePath;
}

for (const relativePath of [
  'index.html',
  'calculation.js',
  'pwa-update.js',
  'data-setup-progress.js',
  'share-content-model.js',
  'share-coordinator.js',
  'share-png-store.js',
  'share-image-renderer.js',
  'vendor/html2canvas.min.js',
  'vendor/licenses/html2canvas-MIT-LICENSE.txt',
  'app.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'data/Item.json',
  'data/legacy-item-ids.json',
  'data/tips.md',
  'assets/app-icons/favicon.png',
  'assets/app-icons/share.webp',
  'assets/app-icons/icon-192.png',
  'assets/app-icons/icon-512.png',
  'assets/branding/xivca-logo.webp',
  'assets/check_onoff.png',
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

const itemData = JSON.parse(fs.readFileSync(requireFile('data/Item.json'), 'utf8'));
if (!itemData || typeof itemData.Version !== 'string' || !Array.isArray(itemData.Items)) {
  throw new Error('Item.json must contain Version and Items.');
}
const items = itemData.Items;
const itemNames = new Set(items.map(item => item.Name));
const legacyItemIds = JSON.parse(fs.readFileSync(requireFile('data/legacy-item-ids.json'), 'utf8'));
if (!legacyItemIds?.Items || typeof legacyItemIds.Items !== 'object') throw new Error('Invalid legacy-item-ids.json.');
const tipsMarkdown = fs.readFileSync(requireFile('data/tips.md'), 'utf8');
const serviceWorkerSource = fs.readFileSync(requireFile('sw.js'), 'utf8');
const currentAppVersion = extractAppVersion(serviceWorkerSource);
if (!currentAppVersion || !extractReleaseMarkdown(tipsMarkdown, currentAppVersion)) {
  throw new Error(`tips.md does not contain the current release section: ${currentAppVersion || 'unknown'}`);
}
const indexHtml = fs.readFileSync(requireFile('index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(requireFile('manifest.webmanifest'), 'utf8'));
if (!indexHtml.includes(`<title>${applicationWindowTitle}</title>`) || !indexHtml.includes(`alt="${applicationName}"`)) {
  throw new Error('Application name or XIVca logo accessibility text is missing from index.html.');
}
if (manifest.name !== applicationName || manifest.short_name !== 'XIVca') {
  throw new Error('Application name is not synchronized with manifest.webmanifest.');
}

const invalidStaticItemIconReferences = [];
for (const match of indexHtml.matchAll(/(?:\.\/)?assets\/item-icons\/([^"'?#\s<>)]+)/g)) {
  const referencedPath = match[1];
  const parts = referencedPath.split('/');
  const folder = parts.at(-2) || '';
  const fileName = parts.at(-1) || '';
  if (
    parts.length !== 2
    || !/^[0-9a-f]{20}-[0-9a-f]{12}\.webp$/.test(fileName)
    || folder !== fileName.slice(0, 3)
    || !fs.existsSync(path.join(siteRoot, 'assets', 'item-icons', referencedPath))
  ) {
    invalidStaticItemIconReferences.push(referencedPath);
  }
}
if (invalidStaticItemIconReferences.length > 0) {
  throw new Error(`Invalid static item icon references: ${invalidStaticItemIconReferences.join(', ')}`);
}

const missingIcons = [];
const invalidIconFiles = [];
const invalidEquipmentPerformance = [];
const invalidPublicItems = [];
const pipelineOnlyItemKeys = [
  'Description',
  'LevelEquip',
  'ItemSearchCategory',
  'ItemSearchCategoryName',
  'LodestoneInfoCheckedAt',
  'LodestoneInfoVersion'
];
const equipmentPerformanceKeys = new Set([
  'physicalDamage',
  'magicalDamage',
  'physicalDefense',
  'magicalDefense'
]);
for (const item of items) {
  if (
    pipelineOnlyItemKeys.some(key => Object.hasOwn(item, key))
    || item.IsEx === false
    || Object.hasOwn(item.EquipmentInfo || {}, 'statsVersion')
    || Object.values(item.EquipmentInfo?.stats || {}).includes(0)
    || Object.values(item.EquipmentInfo?.performance || {}).includes(0)
    || Object.hasOwn(item, 'ID')
  ) {
    invalidPublicItems.push(item.Name || item.ID);
  }
  for (const recipe of [...(item.Recipe ? [item.Recipe] : []), ...(item.Recipes || [])]) {
    for (const ingredient of recipe.Ingredients || []) {
      if (!ingredient.Name || !itemNames.has(ingredient.Name) || Object.hasOwn(ingredient, 'ItemID')) {
        invalidPublicItems.push(item.Name || item.ID);
      }
      if (Object.hasOwn(recipe, 'PatchNumber') || Object.hasOwn(recipe, 'RecipeID')) invalidPublicItems.push(item.Name);
    }
  }
  if (item.EquipmentInfo) {
    const performance = item.EquipmentInfo.performance;
    const physicalDamage = Number(performance?.physicalDamage || 0);
    const magicalDamage = Number(performance?.magicalDamage || 0);
    const entries = Object.entries(performance || {});
    if (
      entries.some(([key, value]) =>
        !equipmentPerformanceKeys.has(key) || !Number.isFinite(Number(value)) || Number(value) < 0
      )
      || (physicalDamage > 0 && magicalDamage > 0)
    ) {
      invalidEquipmentPerformance.push(item.Name || item.ID);
    }
  }
  if (!item.IconFile) continue;
  const relativePath = path.join('assets', 'item-icons', item.IconFile.slice(0, 3), item.IconFile);
  const absolutePath = path.join(siteRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    missingIcons.push(relativePath);
    continue;
  }
  const bytes = fs.readFileSync(absolutePath);
  const nameHash = crypto.createHash('sha256').update(String(item.Name), 'utf8').digest('hex').slice(0, 20);
  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  if (item.IconFile !== `${nameHash}-${contentHash}.webp`) invalidIconFiles.push(`${item.Name}: ${item.IconFile}`);
}

if (invalidPublicItems.length > 0) {
  throw new Error(`Invalid public Item.json projection: ${invalidPublicItems.slice(0, 10).join(', ')}`);
}

if (invalidEquipmentPerformance.length > 0) {
  throw new Error(
    `Invalid equipment performance data: ${invalidEquipmentPerformance.slice(0, 10).join(', ')}`
  );
}

if (missingIcons.length > 0) {
  throw new Error(`Missing item icon files: ${missingIcons.slice(0, 10).join(', ')}`);
}

if (invalidIconFiles.length > 0) {
  throw new Error(`Invalid item icon filenames: ${invalidIconFiles.slice(0, 10).join(', ')}`);
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
  `Validated ${items.length} name-key items (Lodestone ${itemData.Version}) and ${powershellFiles.length} PowerShell files. ` +
  `${items.filter(item => item.IconFile).length} item icon filenames and contents are valid.`
);
