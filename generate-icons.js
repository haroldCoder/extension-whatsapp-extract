const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create directory if not exists
const iconsDir = path.join(__dirname, 'extension', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

function createPNG(size, bgHex, iconHex) {
  // Parse hex colors
  const parseHex = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255
  ];
  const bg = parseHex(bgHex);
  const fg = parseHex(iconHex);

  const width = size;
  const height = size;
  const rawData = Buffer.alloc(height * (width * 4 + 1));

  const center = size / 2;
  const radius = size * 0.44;

  let pos = 0;
  for (let y = 0; y < height; y++) {
    rawData[pos++] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // WhatsApp bubble style with extract icon in center
        const innerDist = Math.sqrt((dx) * (dx) + (dy + size * 0.05) * (dy + size * 0.05));
        const inInnerBubble = innerDist <= radius * 0.75;
        const inSpeechTail = (x > center * 0.4 && x < center * 0.8 && y > center * 1.1 && y < center * 1.5 && (y - center * 1.1) > (x - center * 0.4) * 0.8);

        // Simple badge or message symbol
        const inBox = (x >= center * 0.65 && x <= center * 1.35 && y >= center * 0.7 && y <= center * 1.3);
        const inLines = (x >= center * 0.8 && x <= center * 1.2 && (Math.abs(y - center * 0.9) <= size * 0.05 || Math.abs(y - center * 1.1) <= size * 0.05));

        if (inLines) {
          rawData[pos++] = fg[0];
          rawData[pos++] = fg[1];
          rawData[pos++] = fg[2];
          rawData[pos++] = fg[3];
        } else {
          rawData[pos++] = bg[0];
          rawData[pos++] = bg[1];
          rawData[pos++] = bg[2];
          rawData[pos++] = bg[3];
        }
      } else {
        // Transparent
        rawData[pos++] = 0;
        rawData[pos++] = 0;
        rawData[pos++] = 0;
        rawData[pos++] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG structure
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);

    let crc = -1;
    const combined = Buffer.concat([typeBuf, data]);
    for (let i = 0; i < combined.length; i++) {
      crc = crcTable[(crc ^ combined[i]) & 0xff] ^ (crc >>> 8);
    }
    crc = (crc ^ -1) >>> 0;
    crcBuf.writeUInt32BE(crc, 0);

    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // Precompute CRC table
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngHeader, ihdrChunk, idatChunk, iendChunk]);
}

[16, 48, 128].forEach(size => {
  const png = createPNG(size, '#25D366', '#FFFFFF');
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Generated icon${size}.png`);
});
