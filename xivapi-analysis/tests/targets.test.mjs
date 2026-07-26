import assert from "node:assert/strict";
import test from "node:test";
import { buildTargetItems } from "../lib/targets.mjs";

test("target extraction includes ingredients that have no recipe", () => {
  const result = buildTargetItems([
    {
      ID: "100",
      Name: "完成品",
      Recipe: {
        Ingredients: [
          { ItemID: "200", Name: "中間素材" },
          { ItemID: "300", Name: "採集素材" },
        ],
      },
    },
    {
      ID: "200",
      Name: "中間素材",
      Recipe: {
        Ingredients: [
          { ItemID: "300", Name: "採集素材" },
          { ItemID: "400", Name: "シャード" },
        ],
      },
    },
    { ID: "300", Name: "採集素材" },
    { ID: "400", Name: "シャード" },
    { ID: "500", Name: "無関係なアイテム" },
  ]);

  assert.deepEqual([...result.targetIds].sort(), ["100", "200", "300", "400"]);
  assert.equal(result.recipeResultCount, 2);
  assert.equal(result.ingredientWithoutRecipeCount, 2);
  assert.equal(result.targetCount, 4);
});
