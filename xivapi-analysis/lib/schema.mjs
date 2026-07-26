import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

function collectTargets(definition) {
  const targets = new Set();
  if (Array.isArray(definition?.targets)) {
    for (const target of definition.targets)
      if (typeof target === "string") targets.add(target);
  }
  const cases = definition?.condition?.cases;
  if (cases && typeof cases === "object") {
    for (const value of Object.values(cases)) {
      for (const target of Array.isArray(value) ? value : [value]) {
        if (typeof target === "string") targets.add(target);
      }
    }
  }
  return [...targets];
}

function addScalar(columns, header, definition) {
  if (!header) return;
  const targets = collectTargets(definition);
  columns.set(header, {
    header,
    type: definition?.type ?? "scalar",
    targets,
    condition: definition?.condition ?? null,
    comment: definition?.comment ?? null,
  });
}

function flattenField(columns, definition, prefix = "") {
  const name = typeof definition?.name === "string" ? definition.name : "";
  const base = name ? `${prefix}${name}` : prefix.replace(/\.$/, "");

  if (definition?.type === "array") {
    for (let index = 0; index < Number(definition.count ?? 0); index += 1) {
      const arrayPath = `${base}[${index}]`;
      if (Array.isArray(definition.fields) && definition.fields.length > 0) {
        if (definition.fields.length === 1 && !definition.fields[0].name) {
          flattenField(columns, definition.fields[0], arrayPath);
        } else {
          for (const child of definition.fields)
            flattenField(columns, child, `${arrayPath}.`);
        }
      } else {
        addScalar(columns, arrayPath, definition);
      }
    }
    return;
  }

  if (Array.isArray(definition?.fields) && definition.fields.length > 0) {
    const childPrefix = name ? `${base}.` : prefix;
    for (const child of definition.fields)
      flattenField(columns, child, childPrefix);
    return;
  }

  addScalar(columns, base, definition);
}

export function flattenSchema(schema) {
  const columns = new Map();
  for (const field of schema?.fields ?? []) flattenField(columns, field);
  return {
    sheet: schema?.name ?? null,
    displayField: schema?.displayField ?? null,
    columns,
  };
}

export function loadSchemas(schemaRoot) {
  const schemas = new Map();
  for (const entry of fs.readdirSync(schemaRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".yml")) continue;
    const filePath = path.join(schemaRoot, entry.name);
    const schema = flattenSchema(parse(fs.readFileSync(filePath, "utf8")));
    const sheet = schema.sheet ?? path.basename(entry.name, ".yml");
    schemas.set(sheet, { ...schema, sheet, file: entry.name });
  }
  return schemas;
}
