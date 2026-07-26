import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { parseCsvStream } from "../lib/csv.mjs";

test("CSV parser handles commas, escaped quotes and embedded newlines", async () => {
  const source =
    '#,Name,Description\r\n1,"素材, A","一行目\n二行目"\r\n2,"""引用""",通常\r\n';
  const rows = [];
  for await (const row of parseCsvStream(
    Readable.from([source.slice(0, 23), source.slice(23)]),
  ))
    rows.push(row);
  assert.deepEqual(rows, [
    ["#", "Name", "Description"],
    ["1", "素材, A", "一行目\n二行目"],
    ["2", '"引用"', "通常"],
  ]);
});
