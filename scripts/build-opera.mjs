import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const sourceDir = resolve('dist');
const outputDir = resolve('dist-opera');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(sourceDir, outputDir, { recursive: true });

const manifestPath = resolve(outputDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.name = 'Human Rate Typer for Opera GX';
manifest.description = 'Clean pasted text and type it into web editors at a configurable human pace in Opera GX.';
manifest.permissions = manifest.permissions.filter((permission) => permission !== 'sidePanel');
if (!manifest.permissions.includes('tabs')) manifest.permissions.push('tabs');
delete manifest.side_panel;
delete manifest.minimum_chrome_version;
manifest.action = {
  default_title: 'Open Human Rate Typer',
  default_popup: 'sidepanel.html',
};
manifest.sidebar_action = {
  default_icon: 'opera-icon.png',
  default_title: 'Human Rate Typer',
  default_panel: 'sidepanel.html',
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createIcon(size = 32) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const offset = 1 + x * 4;
      const roundedCorner = (x < 4 && y < 4) || (x >= size - 4 && y < 4) ||
        (x < 4 && y >= size - 4) || (x >= size - 4 && y >= size - 4);
      const line = x >= 7 && x <= 24 && (y === 9 || (y === 15 && x <= 20) || (y === 21 && x <= 16));
      const [red, green, blue, alpha] = roundedCorner
        ? [0, 0, 0, 0]
        : line ? [169, 219, 187, 255] : [23, 33, 28, 255];
      row[offset] = red;
      row[offset + 1] = green;
      row[offset + 2] = blue;
      row[offset + 3] = alpha;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await writeFile(resolve(outputDir, 'opera-icon.png'), createIcon());
console.log(`Opera GX extension built at ${outputDir}`);
