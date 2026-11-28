"use strict";
const zlib = require("node:zlib");

/**
 * utils/zip.js — a plain .zip file, written and read with Node alone
 * ────────────────────────────────────────────────────────────────────
 * Just what the database backup (utils/dbBackup.js) needs, with no package to
 * install on the server:
 *
 *   createZip([{ name: "folder/file.txt", data: Buffer }], { date })  → Buffer
 *   readZip(buffer)  → Map(name → Buffer), every entry's CRC checked
 *
 * The files open with a double-click on Windows and macOS, and with 7-Zip /
 * `unzip`. Names are UTF-8 (flag bit 11). Each entry is deflated, or stored
 * as-is when deflating doesn't make it smaller (photos, PDFs). No ZIP64: one
 * file and the whole archive must stay under 4 GB, far above this app's data.
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

// MS-DOS date and time (local clock fields of `d`, 2-second steps).
const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff;
const dosDate = (d) => (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

const LIMIT = 0xffffffff;

/** A .zip of `entries` ({ name, data }); `date` stamps every entry (default now). */
const createZip = (entries, { date = new Date() } = {}) => {
  const time = dosTime(date);
  const day = dosDate(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data == null ? "" : String(data));
    const fileName = Buffer.from(String(name).replace(/\\/g, "/"), "utf8");
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const crc = crc32(raw);
    if (raw.length >= LIMIT || body.length >= LIMIT || offset >= LIMIT) throw new Error("Backup too large for a .zip (over 4 GB)");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, fileName, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0 (so permissions below are read)
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName);

    offset += 30 + fileName.length + body.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  if (entries.length > 0xffff) throw new Error("Too many files for a .zip (over 65,535)");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
};

/** Every file in a .zip, by name. Throws on anything damaged (bad CRC, cut short, not a zip). */
const readZip = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("Not a zip file");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no directory at the end — is it complete?)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Damaged zip file (directory)");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue; // a folder entry
    if (buf.readUInt32LE(localAt) !== 0x04034b50) throw new Error(`Damaged zip file (${name})`);
    const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const body = buf.subarray(start, start + size);
    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = zlib.inflateRawSync(body);
    else throw new Error(`Unsupported compression in ${name}`);
    if (crc32(data) !== crc) throw new Error(`Damaged zip file: ${name} doesn't match its checksum`);
    out.set(name, data);
  }
  return out;
};

const isZip = (buf) => Buffer.isBuffer(buf) && buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;

module.exports = { createZip, readZip, isZip, crc32 };
