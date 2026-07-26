import assert from "node:assert/strict";
import test from "node:test";

import {
  diffSize,
  exceedsDiffBudget,
  usesCrLf,
} from "../tools/safe-format.mjs";

test("safe formatter rejects large line counts and ratios", () => {
  assert.equal(exceedsDiffBudget(201, 2000), true);
  assert.equal(exceedsDiffBudget(51, 200), true);
  assert.equal(exceedsDiffBudget(50, 200), false);
});

test("safe formatter detects and preserves the existing line-ending choice", () => {
  assert.equal(usesCrLf("first\r\nsecond\r\n"), true);
  assert.equal(usesCrLf("first\nsecond\n"), false);
});

test("safe formatter measures changed lines without writing the source file", () => {
  assert.equal(diffSize("first\nsecond\n", "first\nchanged\n", ".txt"), 2);
});
