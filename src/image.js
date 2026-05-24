const sharp = require('sharp');

async function applyMask(originalBuffer, maskBuffer) {
  const mask = sharp(maskBuffer);
  const maskMeta = await mask.metadata();
  const origMeta = sharp(originalBuffer);
  const origInfo = await origMeta.metadata();

  const finalMask = (origInfo.width !== maskMeta.width || origInfo.height !== maskMeta.height)
    ? await mask.resize(origInfo.width, origInfo.height, { fit: 'fill' }).toBuffer()
    : maskBuffer;

  return sharp(originalBuffer)
    .joinChannel(await sharp(finalMask).ensureAlpha().greyscale().toBuffer())
    .png()
    .toBuffer();
}

module.exports = { applyMask };
