import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultConfigPath = path.join(repositoryRoot, 'tools', 'release-notes-review.json');

export function extractTestTitles(source) {
  const titles = [];
  const pattern = /\btest\(\s*(['"`])([\s\S]*?)\1\s*,/g;
  for (const match of source.matchAll(pattern)) {
    const title = match[2].replace(/\\(['"`\\])/g, '$1').trim();
    if (title) titles.push(title);
  }
  return titles;
}

export function extractReleaseSection(markdown, version) {
  const heading = `## ${version} リリース`;
  const start = markdown.indexOf(heading);
  if (start < 0) return '';
  const remainder = markdown.slice(start + heading.length);
  const nextRelease = remainder.search(/\n---\s*\n\s*## v[^\n]+リリース/);
  return nextRelease < 0 ? markdown.slice(start) : markdown.slice(start, start + heading.length + nextRelease);
}

export function auditReleaseNotes({ addedTitles, reviews, releaseSection }) {
  const errors = [];
  const reviewByTest = new Map();

  for (const review of reviews) {
    if (!review || typeof review.test !== 'string' || !review.test.trim()) {
      errors.push('Review entries must have a non-empty test title.');
      continue;
    }
    if (reviewByTest.has(review.test)) {
      errors.push(`Duplicate review entry: ${review.test}`);
      continue;
    }
    reviewByTest.set(review.test, review);
  }

  for (const title of addedTitles) {
    const review = reviewByTest.get(title);
    if (!review) {
      errors.push(`Unreviewed user-facing E2E change: ${title}`);
      continue;
    }
    if (review.disposition === 'documented') {
      if (!Array.isArray(review.evidence) || review.evidence.length === 0) {
        errors.push(`Documented change has no release-note evidence: ${title}`);
        continue;
      }
      for (const phrase of review.evidence) {
        if (typeof phrase !== 'string' || !phrase || !releaseSection.includes(phrase)) {
          errors.push(`Release note for "${title}" is missing evidence phrase: ${phrase}`);
        }
      }
    } else if (review.disposition === 'internal' || review.disposition === 'omitted') {
      if (typeof review.reason !== 'string' || !review.reason.trim()) {
        const label = review.disposition === 'internal' ? 'Internal change' : 'Omitted change';
        errors.push(`${label} has no omission reason: ${title}`);
      }
    } else {
      errors.push(`Unknown disposition for "${title}": ${review.disposition}`);
    }
  }

  for (const title of reviewByTest.keys()) {
    if (!addedTitles.includes(title)) errors.push(`Stale review entry not found in the release diff: ${title}`);
  }
  return errors;
}

export function runReleaseNotesAudit(root = repositoryRoot, configPath = defaultConfigPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const baselineTestFiles = config.baselineTestFiles || [config.baselineTestFile || config.testFile];
  const currentTestFiles = config.testFiles || [config.testFile];
  const baselineSource = baselineTestFiles
    .map(testFile =>
      execFileSync('git', ['show', `${config.baseline}:${testFile}`], {
        cwd: root,
        encoding: 'utf8'
      })
    )
    .join('\n');
  const currentSource = currentTestFiles
    .map(testFile => fs.readFileSync(path.join(root, testFile), 'utf8'))
    .join('\n');
  const baselineTitles = new Set(extractTestTitles(baselineSource));
  const addedTitles = extractTestTitles(currentSource).filter(title => !baselineTitles.has(title));
  const tips = fs.readFileSync(path.join(root, config.tipsFile), 'utf8');
  const releaseSection = extractReleaseSection(tips, config.version);
  const errors = releaseSection
    ? auditReleaseNotes({ addedTitles, reviews: config.reviews, releaseSection })
    : [`Release section not found: ${config.version}`];

  if (errors.length > 0) {
    throw new Error(`Release-note audit failed:\n- ${errors.join('\n- ')}`);
  }
  return { version: config.version, reviewedTests: addedTitles.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runReleaseNotesAudit();
    console.log(`Release-note audit passed for ${result.version}: ${result.reviewedTests} E2E changes reviewed.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
