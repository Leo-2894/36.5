"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { cards } = require("./rules.js");

const cardFiles = new Set(cards.map(card => card.id + ".png"));
const maxBytes = 8 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function isCardArtwork(file) {
  return cardFiles.has(file);
}

async function readCustomCardArt(directory, file, canDecode) {
  if (!isCardArtwork(file)) return null;
  try {
    if (!(await fs.lstat(directory)).isDirectory()) return null;
    const source = path.join(directory, file);
    const info = await fs.lstat(source);
    if (!info.isFile() || info.size > maxBytes || info.size < 33) return null;
    const data = await fs.readFile(source);
    if (data.length < 33 || data.length > maxBytes ||
        !data.subarray(0, 8).equals(pngSignature) ||
        data.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 4096 || !canDecode(data)) return null;
    return data;
  } catch {
    // Missing, unreadable or invalid overrides fall back to the bundled art.
    return null;
  }
}

module.exports = { isCardArtwork, readCustomCardArt };
