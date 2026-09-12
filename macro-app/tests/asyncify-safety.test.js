import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectIndirectStoragePaths } from '../tools/asyncify-safety.mjs';
const module = body => `(module
 (import "m" "__wbg_read_a" (func $read (type $0)))
 (import "m" "__wbg_write_b" (func $write (type $0)))
 (table $table 1 1 funcref)
 (elem $element (i32.const 0) $target)
${body}
)`;
test('閉じた関数テーブルから退避へ到達しない場合だけ省略を許可する', () => {
  const wat = module(` (func $target (type $0) (nop))
 (func $solve (type $0) (call $read))`);
  assert.equal(inspectIndirectStoragePaths(wat, '').safe, true);
});
test('間接呼び出しの先から推移的に退避へ到達する場合は省略しない', () => {
  const wat = module(` (func $target (type $0) (call $middle))
 (func $middle (type $0) (call $write))`);
  assert.equal(inspectIndirectStoragePaths(wat, '').safe, false);
});
test('動的変更・外部公開・未知のテーブル記述は省略しない', () => {
  for (const extra of [' (export "table" (table $table))', ' (table.set $table)', ' (ref.func $target)',
    ' (call_ref $type)', ' (return_call $read)', ' (elem $passive $target)']) {
    assert.equal(inspectIndirectStoragePaths(module(` (func $target (type $0) (nop))\n${extra}`), '').safe, false);
  }
});
test('間接呼び出しの外部関数は確認済み文字列変換だけを許可する', () => {
  const wat = module(' (func $target (type $0) (nop))')
    .replace('$target)\n', '$external)\n')
    .replace(' (table', ' (import "m" "__wbindgen_generic_1" (func $external (type $0)))\n (table');
  assert.equal(inspectIndirectStoragePaths(wat, '').safe, false);
  const glue = `__wbindgen_generic_1: function(arg0, arg1) {
    // Cast intrinsic for \`Ref(String) -> Externref\`.
    const ret = getStringFromWasm0(arg0, arg1);
    return addHeapObject(ret);
  },`;
  assert.equal(inspectIndirectStoragePaths(wat, glue).safe, true);
  assert.equal(inspectIndirectStoragePaths(wat, glue.replace('return addHeapObject(ret);', 'return storage.read(ret);')).safe, false);
});
