const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.join(__dirname, '..', 'generated');

function ensureDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function applyMask(originalBuffer, maskBuffer) {
  ensureDir();

  const maskPng = sharp(maskBuffer);
  const maskMeta = await maskPng.metadata();

  const original = sharp(originalBuffer);
  const origMeta = await original.metadata();

  const finalMask = (origMeta.width !== maskMeta.width || origMeta.height !== maskMeta.height)
    ? await maskPng.resize(origMeta.width, origMeta.height, { fit: 'fill' }).toBuffer()
    : maskBuffer;

  const result = await sharp(originalBuffer)
    .joinChannel(await sharp(finalMask).ensureAlpha().greyscale().toBuffer())
    .png()
    .toBuffer();

  const outPath = path.join(OUTPUT_DIR, `${Date.now()}.png`);
  await fs.promises.writeFile(outPath, result);
  return outPath;
}

module.exports = { applyMask };
