import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditReleaseNotes,
  extractReleaseSection,
  extractTestTitles
} from '../tools/check-release-notes.mjs';

test('extracts E2E test titles and the requested release section', () => {
  const source = `
    test('first behavior', async () => {});
    test(
      'second behavior',
      async () => {}
    );
  `;
  assert.deepEqual(extractTestTitles(source), ['first behavior', 'second behavior']);
  const markdown = `
## v2.95 リリース
- 一括で指定・解除

---
## v2.92 リリース
- old
`;
  assert.match(extractReleaseSection(markdown, 'v2.95'), /一括で指定・解除/);
  assert.doesNotMatch(extractReleaseSection(markdown, 'v2.95'), /old/);
});

test('rejects an unreviewed E2E change', () => {
  const errors = auditReleaseNotes({
    addedTitles: ['bulk controls'],
    reviews: [],
    releaseSection: '## v2.95 リリース'
  });
  assert.deepEqual(errors, ['Unreviewed user-facing E2E change: bulk controls']);
});

test('rejects missing release-note evidence and accepts explicit evidence', () => {
  const review = {
    test: 'bulk controls',
    disposition: 'documented',
    evidence: ['一括で指定・解除']
  };
  assert.equal(
    auditReleaseNotes({
      addedTitles: ['bulk controls'],
      reviews: [review],
      releaseSection: '## v2.95 リリース'
    }).length,
    1
  );
  assert.deepEqual(
    auditReleaseNotes({
      addedTitles: ['bulk controls'],
      reviews: [review],
      releaseSection: '## v2.95 リリース\n- 一括で指定・解除'
    }),
    []
  );
});

test('requires a concrete reason for an intentional omission', () => {
  const errors = auditReleaseNotes({
    addedTitles: ['internal safeguard'],
    reviews: [{ test: 'internal safeguard', disposition: 'internal', reason: '' }],
    releaseSection: '## v2.95 リリース'
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /omission reason/);
});

test('accepts a release-owner omission only with a concrete reason', () => {
  const review = {
    test: 'release-owner omission',
    disposition: 'omitted',
    reason: 'The release owner explicitly decided to keep the canonical notes concise.'
  };
  assert.deepEqual(
    auditReleaseNotes({
      addedTitles: ['release-owner omission'],
      reviews: [review],
      releaseSection: '## v3.0 リリース'
    }),
    []
  );
  review.reason = '';
  assert.match(
    auditReleaseNotes({
      addedTitles: ['release-owner omission'],
      reviews: [review],
      releaseSection: '## v3.0 リリース'
    })[0],
    /omission reason/
  );
});
