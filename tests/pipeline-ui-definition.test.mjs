import assert from "node:assert/strict";
import test from "node:test";
import {
  getPipelineUiDefinition,
  validatePipelineUiDefinition,
} from "../pipeline/tool/pipeline-ui-definition.mjs";

test("pipeline UI definition has unique sections, actions, and commands", () => {
  const definition = getPipelineUiDefinition();
  assert.deepEqual(validatePipelineUiDefinition(definition), []);
  assert.equal(
    new Set(definition.sections.map((section) => section.id)).size,
    definition.sections.length,
  );
  assert.equal(
    new Set(definition.actions.map((action) => action.id)).size,
    definition.actions.length,
  );
  const commands = definition.actions
    .map((action) => action.command)
    .filter(Boolean);
  assert.equal(new Set(commands).size, commands.length);
});

test("recommended pipeline commands resolve to declared argument mappings", () => {
  const definition = getPipelineUiDefinition();
  const byCommand = new Map(
    definition.actions.map((action) => [action.command, action]),
  );
  for (const command of definition.recommendedSequence) {
    assert.ok(
      byCommand.has(command),
      `missing recommended command: ${command}`,
    );
    const action = byCommand.get(command);
    assert.ok(Array.isArray(action.sequenceArgs || action.args));
  }
});

test("invalid pipeline UI definitions are rejected before rendering", () => {
  const definition = getPipelineUiDefinition();
  definition.actions.push({ ...definition.actions[0] });
  assert.match(
    validatePipelineUiDefinition(definition).join("\n"),
    /duplicate action id/,
  );
});
