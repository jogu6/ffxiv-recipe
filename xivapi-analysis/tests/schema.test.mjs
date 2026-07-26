import assert from "node:assert/strict";
import test from "node:test";
import { flattenSchema } from "../lib/schema.mjs";

test("schema flattener preserves nested array link targets", () => {
  const schema = flattenSchema({
    name: "Example",
    fields: [
      {
        name: "Rows",
        type: "array",
        count: 2,
        fields: [
          { name: "Count" },
          {
            name: "Item",
            type: "array",
            count: 2,
            fields: [{ type: "link", targets: ["Item"] }],
          },
        ],
      },
    ],
  });

  assert.deepEqual(schema.columns.get("Rows[1].Item[0]").targets, ["Item"]);
  assert.deepEqual(schema.columns.get("Rows[0].Count").targets, []);
});

test("schema flattener keeps multiref targets distinct from Item", () => {
  const schema = flattenSchema({
    name: "GatheringPointBase",
    fields: [
      {
        name: "Item",
        type: "array",
        count: 1,
        fields: [
          { type: "link", targets: ["GatheringItem", "SpearfishingItem"] },
        ],
      },
    ],
  });

  assert.deepEqual(schema.columns.get("Item[0]").targets, [
    "GatheringItem",
    "SpearfishingItem",
  ]);
  assert.equal(schema.columns.get("Item[0]").targets.includes("Item"), false);
});
