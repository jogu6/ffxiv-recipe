const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPTURE_BACKGROUND, MAX_HEIGHT, MAX_WIDTH } = require('../site/share-image-renderer.js');

test('share image dimensions are capped at the approved PNG limits', () => {
  assert.equal(MAX_WIDTH, 1080);
  assert.equal(MAX_HEIGHT, 4630);
  assert.equal(CAPTURE_BACKGROUND, '#1a1a1a');
});
