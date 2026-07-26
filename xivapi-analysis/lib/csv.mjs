import fs from "node:fs";

export async function* parseCsvStream(stream) {
  stream.setEncoding("utf8");
  let row = [];
  let field = "";
  let quoted = false;
  let pendingQuote = false;
  let pendingCarriageReturn = false;

  const emitField = () => {
    row.push(field);
    field = "";
  };

  for await (const chunk of stream) {
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index];

      if (pendingCarriageReturn) {
        pendingCarriageReturn = false;
        if (character === "\n") continue;
      }

      if (quoted) {
        if (pendingQuote) {
          if (character === '"') {
            field += '"';
            pendingQuote = false;
            continue;
          }
          quoted = false;
          pendingQuote = false;
        } else if (character === '"') {
          pendingQuote = true;
          continue;
        } else {
          field += character;
          continue;
        }
      }

      if (character === '"' && field.length === 0) {
        quoted = true;
      } else if (character === ",") {
        emitField();
      } else if (character === "\n" || character === "\r") {
        emitField();
        yield row;
        row = [];
        if (character === "\r") pendingCarriageReturn = true;
      } else {
        field += character;
      }
    }
  }

  if (pendingQuote) quoted = false;
  if (field.length > 0 || row.length > 0) {
    emitField();
    yield row;
  }
}

export function parseCsvFile(filePath) {
  return parseCsvStream(fs.createReadStream(filePath));
}
