import assert from "node:assert/strict";
import test from "node:test";
import { getPipelineUiDefinition, validatePipelineUiDefinition } from "../pipeline/tool/pipeline-ui-definition.mjs";

test("pipeline UI definition has unique recursive settings and executable actions", () => {
  const definition = getPipelineUiDefinition();
  assert.deepEqual(validatePipelineUiDefinition(definition), []);
  assert.equal(definition.schemaVersion, 2);
  assert.equal(new Set(definition.modules.map(module => module.id)).size, definition.modules.length);
  for (const module of definition.modules) {
    const ids = new Set();
    const visit = node => {
      assert.ok(node.id);
      assert.equal(ids.has(node.id), false, `duplicate node: ${node.id}`);
      ids.add(node.id);
      for (const child of node.children || []) visit(child);
    };
    for (const node of module.settings) visit(node);
    for (const action of module.actions) {
      assert.equal(ids.has(action.id), false, `duplicate action: ${action.id}`);
      ids.add(action.id);
    }
  }
});

test("complete Item.json action resolves to all required publication commands and settings", () => {
  const module = getPipelineUiDefinition().modules[0];
  const complete = module.actions.find(action => action.id === "generate-item-json");
  assert.deepEqual(complete.sequence, [
    "lodestone-audit",
    "build-lodestone-candidate",
    "item-icon-cache",
    "lodestone-candidate-icons",
    "publish-lodestone-candidate",
    "share-code-plaza-icons",
    "item-icon-validate",
  ]);
  for (const id of complete.sequence) assert.ok(module.actions.find(action => action.id === id)?.command);
  assert.deepEqual(complete.settingIds, ["lodestone-delay", "webp-quality", "icon-size"]);
  assert.deepEqual(module.actions.find(action => action.id === "build-lodestone-candidate").args, [
    { flag: "--delay", settingId: "lodestone-delay" },
  ]);
});

test("invalid recursive definitions are rejected before rendering", () => {
  const definition = getPipelineUiDefinition();
  definition.modules[0].settings[0].children.push({ ...definition.modules[0].settings[0].children[0] });
  assert.match(validatePipelineUiDefinition(definition).join("\n"), /duplicate node id/);
});

test("conditions reject unknown setting references and arbitrary operators", () => {
  const definition = getPipelineUiDefinition();
  definition.modules[0].actions[0].enabledWhen = { settingId: "missing", operator: "eval", value: true };
  const errors = validatePipelineUiDefinition(definition).join("\n");
  assert.match(errors, /unknown condition setting/);
  assert.match(errors, /invalid condition operator/);
});
