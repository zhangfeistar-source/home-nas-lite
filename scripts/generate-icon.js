'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const SIZE = 256;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function insideRoundedRectangle(x, y, left, top, right, bottom, radius) {
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  const deltaX = x - nearestX;
  const deltaY = y - nearestY;
  return deltaX * deltaX + deltaY * deltaY <= radius * radius;
}

function setPixel(pixels, x, y, red, green, blue, alpha = 255) {
  const offset = (y * SIZE + x) * 4;
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
  pixels[offset + 3] = alpha;
}

function createPixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (insideRoundedRectangle(x, y, 10, 10, 245, 245, 46)) {
        const blend = y / (SIZE - 1);
        setPixel(
          pixels,
          x,
          y,
          Math.round(25 + 14 * blend),
          Math.round(86 + 42 * blend),
          Math.round(158 + 34 * blend),
        );
      }
    }
  }

  for (let y = 75; y <= 181; y += 1) {
    for (let x = 48; x <= 208; x += 1) {
      const inBody = insideRoundedRectangle(x, y, 48, 75, 208, 181, 15);
      const inTab = x >= 60 && x <= 126 && y >= 57 && y <= 89;
      if (inBody || inTab) {
        setPixel(pixels, x, y, 244, 249, 255);
      }
    }
  }

  for (let y = 115; y <= 165; y += 1) {
    for (let x = 69; x <= 188; x += 1) {
      if (insideRoundedRectangle(x, y, 69, 115, 188, 165, 8)) {
        setPixel(pixels, x, y, 33, 101, 176);
      }
    }
  }
  for (const centerX of [91, 119, 147]) {
    for (let y = 134; y <= 146; y += 1) {
      for (let x = centerX - 6; x <= centerX + 6; x += 1) {
        const deltaX = x - centerX;
        const deltaY = y - 140;
        if (deltaX * deltaX + deltaY * deltaY <= 36) {
          setPixel(pixels, x, y, 244, 249, 255);
        }
      }
    }
  }
  for (let y = 134; y <= 146; y += 1) {
    for (let x = 166; x <= 177; x += 1) {
      setPixel(pixels, x, y, 124, 214, 139);
    }
  }
  return pixels;
}

function createPng() {
  const pixels = createPixels();
  const scanlines = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const rowOffset = y * (SIZE * 4 + 1);
    scanlines[rowOffset] = 0;
    pixels.copy(scanlines, rowOffset + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const directoryEntry = Buffer.alloc(16);
  directoryEntry[0] = 0;
  directoryEntry[1] = 0;
  directoryEntry[2] = 0;
  directoryEntry[3] = 0;
  directoryEntry.writeUInt16LE(1, 4);
  directoryEntry.writeUInt16LE(32, 6);
  directoryEntry.writeUInt32LE(png.length, 8);
  directoryEntry.writeUInt32LE(header.length + directoryEntry.length, 12);
  return Buffer.concat([header, directoryEntry, png]);
}

function writeIcon(relativePath, icon) {
  const outputPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, icon);
  console.log(`已生成 ${relativePath}`);
}

const icon = createIco(createPng());
writeIcon(path.join('build', 'icon.ico'), icon);
writeIcon(path.join('electron', 'assets', 'icon.ico'), icon);
