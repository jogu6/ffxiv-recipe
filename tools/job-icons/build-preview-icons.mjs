import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir) {
  console.error('Usage: node tools/job-icons/build-preview-icons.mjs <chroma-input-dir> <output-dir>');
  process.exit(1);
}

const manifest = JSON.parse(
  await fs.readFile(new URL('./jobs.json', import.meta.url), 'utf8')
);

const CANVAS_SIZE = 80;
const ARTWORK_SIZE = 72;
const DARK_VALUE = 20;
const TRANSPARENT_GREEN_EXCESS = 205;
const OPAQUE_GREEN_EXCESS = 85;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

await fs.mkdir(outputDir, { recursive: true });

for (const job of manifest) {
  const sourcePath = path.join(inputDir, `${job.id}.png`);
  const { data, info } = await sharp(sourcePath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 4);

  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const sourceOffset = pixel * 3;
    const targetOffset = pixel * 4;
    const red = data[sourceOffset];
    const green = data[sourceOffset + 1];
    const blue = data[sourceOffset + 2];
    const greenExcess = green - Math.max(red, blue);
    const opacityPosition =
      (TRANSPARENT_GREEN_EXCESS - greenExcess) /
      (TRANSPARENT_GREEN_EXCESS - OPAQUE_GREEN_EXCESS);
    const alpha = Math.round(255 * smoothstep(opacityPosition));
    const monochromeValue = (red + blue) / 2 >= 128 ? 255 : DARK_VALUE;

    output[targetOffset] = monochromeValue;
    output[targetOffset + 1] = monochromeValue;
    output[targetOffset + 2] = monochromeValue;
    output[targetOffset + 3] = alpha;
  }

  const trimmed = await sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize(ARTWORK_SIZE, ARTWORK_SIZE, {
      fit: 'inside',
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: trimmed, gravity: 'centre' }])
    .webp({ lossless: true, effort: 6 })
    .toFile(path.join(outputDir, `${job.id}.webp`));
}

console.log(`Wrote ${manifest.length} icons to ${outputDir}`);
