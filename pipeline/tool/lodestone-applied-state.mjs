import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { publicLodestoneDocument } from './lodestone-preservation.mjs';

const defaultRoot = path.resolve(import.meta.dirname, '..', '..');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sourceKeys = ['Version', 'RecipeVersion', 'ItemCount', 'RecipeCount', 'ItemOrderSignature'];

export function appliedStatePath(root = defaultRoot) {
  return path.join(root, 'pipeline', 'state', 'lodestone-applied.json');
}

function validSource(source) {
  return typeof source?.Version === 'string' && source.Version.length > 0
    && typeof source.RecipeVersion === 'string' && source.RecipeVersion.length > 0
    && Number.isSafeInteger(source.ItemCount) && source.ItemCount > 0
    && Number.isSafeInteger(source.RecipeCount) && source.RecipeCount > 0
    && sha256Pattern.test(source.ItemOrderSignature);
}

export function matchesAppliedSource(applied, current) {
  return validSource(applied) && validSource(current)
    && sourceKeys.every(key => applied[key] === current[key]);
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Called only after publication and its validations have completed. Also permits
// explicit migration of an already validated, fully applied candidate.
export function recordAppliedLodestoneState({
  snapshot, candidate,
  itemJsonPath = path.join(defaultRoot, 'site', 'data', 'Item.json'),
  statePath = appliedStatePath(),
  now = new Date()
}) {
  // Completed schema-3 audits require matching item and recipe versions.
  const source = Object.fromEntries(sourceKeys.map(key => [key,
    key === 'RecipeVersion' ? snapshot?.RecipeVersion ?? snapshot?.Version : snapshot?.[key]
  ]));
  if (!validSource(source) || snapshot?.SchemaVersion !== 3 || !snapshot.AuditId
      || !sha256Pattern.test(snapshot.DataGeneration)
      || candidate?.SchemaVersion !== 3 || candidate.AuditId !== snapshot.AuditId
      || candidate.AuditDataGeneration !== snapshot.DataGeneration
      || candidate.Version !== snapshot.Version || !sha256Pattern.test(candidate.DataGeneration)
      || !Array.isArray(candidate.Items) || !candidate.Items.length) {
    throw new Error('反映完了記録の監査・候補データが一致しません');
  }
  const bytes = fs.readFileSync(itemJsonPath);
  const expected = publicLodestoneDocument(candidate);
  if (!isDeepStrictEqual(JSON.parse(bytes.toString('utf8')), expected)) {
    throw new Error('Item.jsonが検証済み候補と一致しないため、反映完了を記録できません');
  }
  const applied = {
    schemaVersion: 1,
    appliedAt: `${new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, -1)}+09:00`,
    ...source,
    AuditId: snapshot.AuditId,
    AuditDataGeneration: snapshot.DataGeneration,
    DataGeneration: candidate.DataGeneration,
    itemJsonSha256: hash(bytes)
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(applied, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, statePath);
  return applied;
}

export function readAppliedLodestoneState({
  repositoryRoot = defaultRoot,
  statePath = appliedStatePath(repositoryRoot),
  itemJsonPath = path.join(repositoryRoot, 'site', 'data', 'Item.json')
} = {}) {
  try {
    const applied = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (applied?.schemaVersion !== 1 || !validSource(applied) || !applied.AuditId
        || !sha256Pattern.test(applied.AuditDataGeneration)
        || !sha256Pattern.test(applied.DataGeneration)
        || !sha256Pattern.test(applied.itemJsonSha256)) return null;
    return hash(fs.readFileSync(itemJsonPath)) === applied.itemJsonSha256 ? applied : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}
