const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePanelLayout } = require('../site/panel-layout.js');

const base = {
  handleWidth: 1,
  sideBySideLeftMinimum: 400,
  stackedLeftMinimum: 212,
  middlePreferredWidth: 280,
  middleMinimumWidth: 160,
  rightMinimumWidth: 192
};

test('shrinks the middle panel before the right panel', () => {
  const layout = resolvePanelLayout({
    ...base,
    viewportWidth: 1000,
    preferredLeftWidth: 600,
    middleOpen: true
  });

  assert.equal(layout.equipmentStacked, false);
  assert.equal(layout.leftWidth, 600);
  assert.equal(layout.middleWidth, 207);
  assert.equal(layout.rightWidth, 192);
  assert.equal(layout.rightBelowMinimum, false);
});

test('reserves middle panel width only while it is open', () => {
  const closed = resolvePanelLayout({
    ...base,
    viewportWidth: 1000,
    preferredLeftWidth: 700,
    middleOpen: false
  });
  const open = resolvePanelLayout({
    ...base,
    viewportWidth: 1000,
    preferredLeftWidth: 700,
    middleOpen: true
  });

  assert.equal(closed.leftWidth, 700);
  assert.equal(closed.middleWidth, 0);
  assert.equal(open.leftWidth, 647);
  assert.equal(open.middleWidth, 160);
  assert.equal(open.rightWidth, 192);
});

test('stacks equipment fields only when all normal minimum widths do not fit', () => {
  const layout = resolvePanelLayout({
    ...base,
    viewportWidth: 601,
    preferredLeftWidth: 400,
    middleOpen: false,
    rightMinimumWidth: 250
  });

  assert.equal(layout.equipmentStacked, true);
  assert.equal(layout.leftWidth, 350);
  assert.equal(layout.rightWidth, 250);
});

test('keeps the middle panel at 160px before reducing the right panel', () => {
  const layout = resolvePanelLayout({
    ...base,
    viewportWidth: 601,
    preferredLeftWidth: 636,
    sideBySideLeftMinimum: 636,
    stackedLeftMinimum: 330,
    middleOpen: true,
    middlePreferredWidth: 476,
    rightMinimumWidth: 318
  });

  assert.equal(layout.equipmentStacked, true);
  assert.equal(layout.leftWidth, 330);
  assert.equal(layout.middleWidth, 160);
  assert.equal(layout.rightWidth, 110);
  assert.equal(layout.rightBelowMinimum, true);
});
