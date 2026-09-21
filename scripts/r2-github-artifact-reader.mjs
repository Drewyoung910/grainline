import { inflateRawSync } from "node:zlib";

const FAIL = "R2 GitHub artifact refused; no archive content disclosed.";
const check = value => { if (!value) throw new Error(FAIL); };
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// One bounded regular JSON file, decoded in memory. No extraction, external
// unzip process, filesystem path resolution, archive comments or ZIP64.
export function readR2GitHubArtifact(archive, filename) {
  try {
    check(Buffer.isBuffer(archive) && archive.length >= 98 && archive.length <= 262144
      && /^r2-application-consumer-[1-9][0-9]{0,19}-[1-9][0-9]{0,5}\.json$/.test(filename));
    const end = archive.length - 22;
    check(archive.readUInt32LE(end) === 0x06054b50 && archive.readUInt16LE(end + 4) === 0
      && archive.readUInt16LE(end + 6) === 0 && archive.readUInt16LE(end + 8) === 1
      && archive.readUInt16LE(end + 10) === 1 && archive.readUInt16LE(end + 20) === 0);
    const central = archive.readUInt32LE(end + 16), centralSize = archive.readUInt32LE(end + 12);
    check(central >= 30 && central + centralSize === end && centralSize >= 46
      && archive.readUInt32LE(central) === 0x02014b50);
    const flags = archive.readUInt16LE(central + 8), method = archive.readUInt16LE(central + 10);
    const crc = archive.readUInt32LE(central + 16), compressed = archive.readUInt32LE(central + 20), size = archive.readUInt32LE(central + 24);
    const nameLength = archive.readUInt16LE(central + 28), extraLength = archive.readUInt16LE(central + 30);
    const commentLength = archive.readUInt16LE(central + 32), attributes = archive.readUInt32LE(central + 38);
    check((flags & ~0x808) === 0 && [0, 8].includes(method) && size > 0 && size <= 16384 && compressed <= 262144
      && archive.readUInt16LE(central + 34) === 0 && archive.readUInt32LE(central + 42) === 0
      && commentLength === 0 && 46 + nameLength + extraLength === centralSize
      && (attributes & 0x10) === 0 && [0, 0x8000].includes((attributes >>> 16) & 0xf000));
    const name = Buffer.from(filename);
    check(nameLength === name.length && archive.subarray(central + 46, central + 46 + nameLength).equals(name));
    const extras = (start, length) => {
      const limit = start + length;
      while (start < limit) {
        check(start + 4 <= limit && archive.readUInt16LE(start) !== 1);
        start += 4 + archive.readUInt16LE(start + 2); check(start <= limit);
      }
    };
    extras(central + 46 + nameLength, extraLength);
    check(archive.readUInt32LE(0) === 0x04034b50 && archive.readUInt16LE(6) === flags
      && archive.readUInt16LE(8) === method && archive.readUInt16LE(26) === nameLength);
    const localExtra = archive.readUInt16LE(28), data = 30 + nameLength + localExtra;
    check(data <= central && archive.subarray(30, 30 + nameLength).equals(name));
    extras(30 + nameLength, localExtra);
    const payloadEnd = data + compressed;
    if (flags & 8) {
      const descriptorSize = central - payloadEnd;
      check([12, 16].includes(descriptorSize));
      const descriptor = payloadEnd + (descriptorSize === 16 ? 4 : 0);
      if (descriptorSize === 16) check(archive.readUInt32LE(payloadEnd) === 0x08074b50);
      check(archive.readUInt32LE(descriptor) === crc && archive.readUInt32LE(descriptor + 4) === compressed
        && archive.readUInt32LE(descriptor + 8) === size);
    } else {
      check(payloadEnd === central && archive.readUInt32LE(14) === crc && archive.readUInt32LE(18) === compressed && archive.readUInt32LE(22) === size);
    }
    const packed = archive.subarray(data, payloadEnd);
    const decoded = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: 16384, info: true });
    const bytes = method === 0 ? decoded : decoded.buffer;
    try {
      if (method === 8) check(decoded.engine.bytesWritten === compressed);
      check(bytes.length === size && crc32(bytes) === crc);
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally { bytes.fill(0); }
  } catch { throw new Error(FAIL); }
}
