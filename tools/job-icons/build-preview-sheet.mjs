import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [inputDir, outputFile] = process.argv.slice(2);
if (!inputDir || !outputFile) {
  console.error('Usage: node tools/job-icons/build-preview-sheet.mjs <icon-dir> <output.png>');
  process.exit(1);
}

const jobs = JSON.parse(await fs.readFile(new URL('./jobs.json', import.meta.url), 'utf8'));
const columns = 4;
const rows = Math.ceil(jobs.length / columns);
const cellWidth = 220;
const cellHeight = 148;
const panelWidth = columns * cellWidth;
const panelHeight = rows * cellHeight;
const composites = [];

for (let panel = 0; panel < 2; panel += 1) {
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const baseX = column * cellWidth;
    const baseY = panel * panelHeight + row * cellHeight;
    const iconPath = path.join(inputDir, `${job.id}.webp`);
    const large = await sharp(iconPath).resize(80, 80).png().toBuffer();
    composites.push({ input: large, left: baseX + 18, top: baseY + 42 });

    for (const [sizeIndex, size] of [16, 20, 24, 32].entries()) {
      const small = await sharp(iconPath).resize(size, size).png().toBuffer();
      composites.push({
        input: small,
        left: baseX + 118 + sizeIndex * 24 + Math.floor((20 - size) / 2),
        top: baseY + 78 + Math.floor((32 - size) / 2),
      });
    }
  }
}

const labels = jobs.map((job, index) => {
  const column = index % columns;
  const row = Math.floor(index / columns);
  return { x: column * cellWidth + 18, y: row * cellHeight + 26, text: job.id };
});
const svg = `
<svg width="${panelWidth}" height="${panelHeight * 2}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${panelWidth}" height="${panelHeight}" fill="#f3f4f6"/>
  <rect y="${panelHeight}" width="${panelWidth}" height="${panelHeight}" fill="#20242b"/>
  <g font-family="Arial, sans-serif" font-size="15">
    ${labels.map(label => `<text x="${label.x}" y="${label.y}" fill="#20242b">${label.text}</text>`).join('')}
    ${labels.map(label => `<text x="${label.x}" y="${panelHeight + label.y}" fill="#f3f4f6">${label.text}</text>`).join('')}
  </g>
  <g font-family="Arial, sans-serif" font-size="10" text-anchor="middle">
    ${[16, 20, 24, 32].map((size, i) => `<text x="${128 + i * 24}" y="45" fill="#687180">${size}</text>`).join('')}
    ${[16, 20, 24, 32].map((size, i) => `<text x="${128 + i * 24}" y="${panelHeight + 45}" fill="#aeb7c3">${size}</text>`).join('')}
  </g>
</svg>`;

await sharp(Buffer.from(svg)).composite(composites).png().toFile(outputFile);
console.log(`Wrote preview sheet to ${outputFile}`);
