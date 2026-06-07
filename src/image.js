const sharp = require('sharp');

async function applyMask(originalBuffer, maskBuffer) {
  const origInfo = await sharp(originalBuffer).metadata();
  const maskInfo = await sharp(maskBuffer).metadata();

  const finalMask = (origInfo.width !== maskInfo.width || origInfo.height !== maskInfo.height)
    ? await sharp(maskBuffer).resize(origInfo.width, origInfo.height, { fit: 'fill' }).toBuffer()
    : maskBuffer;

  return sharp(originalBuffer)
    .joinChannel(await sharp(finalMask).ensureAlpha().greyscale().toBuffer())
    .png()
    .toBuffer();
}

module.exports = { applyMask };
