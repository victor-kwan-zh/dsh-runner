const fs = require("node:fs");
const path = require("node:path");

function pngToIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, pngBuffer]);
}

const pngPath = path.join(__dirname, "..", "assets", "icon-256.png");
const icoPath = path.join(__dirname, "..", "assets", "icon.ico");
fs.writeFileSync(icoPath, pngToIco(fs.readFileSync(pngPath)));
console.log(`wrote ${icoPath}`);
