// A closed, immutable function table permits ignoring indirect calls only when
// none of its targets can reach a storage import through direct calls.
export function inspectIndirectStoragePaths(wat, glue) {
  const reject = reason => ({ safe: false, reason });
  if (/\(import[^\n]*\(table|\(export[^\n]*\(table|\(table\.|\(ref\.func|\(call_ref|\(return_call/.test(wat)) {
    return reject('Mutable, exposed, or unsupported function table');
  }
  const imports = new Map([...wat.matchAll(/^ \(import "[^"]+" "([^"]+)" \(func (\$[^\s)]+)/gm)]
    .map(match => [match[2], match[1]]));
  const roots = [...imports].filter(([, name]) => /^__wbg_(read|write)_/.test(name)).map(([name]) => name);
  if (roots.length !== 2) return reject('Storage import contract changed');
  const functions = new Map();
  for (const body of wat.split(/(?=^ \(func )/m).slice(1)) {
    const match = /^ \(func (\$[^\s)]+) \(type (\$[^\s)]+)\)/.exec(body);
    if (!match) return reject('Unrecognized function declaration');
    functions.set(match[1], new Set([...body.matchAll(/\(call (\$[^\s)]+)/g)].map(call => call[1])));
  }
  if (!functions.size) return reject('No function declarations');
  const targets = new Set();
  for (const line of wat.split('\n').filter(line => /^ \(elem /.test(line))) {
    const match = /^ \(elem \$[^\s]+ \(i32.const \d+\) ((?:\$[^\s)]+\s*)+)\)$/.exec(line.trimEnd());
    if (!match) return reject('Unrecognized element declaration');
    for (const target of match[1].trim().split(/\s+/)) targets.add(target);
  }
  if (!targets.size) return reject('No static element declarations');
  for (const target of targets) {
    if (functions.has(target)) continue;
    const imported = imports.get(target);
    if (!imported) return reject('Unknown table target');
    // This generated cast only reads memory and stores a JS string. It cannot
    // call a storage method, user callback, or return a promise.
    const body = glue.slice(glue.indexOf(imported + ': function')).split('},', 1)[0];
    if (!/^__wbindgen_generic_/.test(imported)
      || !/: function\(arg0, arg1\) \{\s*\/\/ Cast intrinsic for `Ref\(String\) -> Externref`\.\s*const ret = getStringFromWasm0\(arg0, arg1\);\s*return addHeapObject\(ret\);\s*$/.test(body)) {
      return reject('Indirect import is not a verified synchronous cast');
    }
  }
  const reachesStorage = new Set(roots);
  let changed;
  do {
    changed = false;
    for (const [name, calls] of functions) {
      if (!reachesStorage.has(name) && [...calls].some(call => reachesStorage.has(call))) {
        reachesStorage.add(name); changed = true;
      }
    }
  } while (changed);
  const unsafeTargets = [...targets].filter(target => reachesStorage.has(target));
  return unsafeTargets.length ? reject('An indirect target reaches storage')
    : { safe: true, functionCount: functions.size, tableTargets: targets.size, storagePaths: reachesStorage.size };
}
