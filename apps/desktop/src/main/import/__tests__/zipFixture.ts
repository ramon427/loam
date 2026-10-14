import { crc32, deflateRawSync } from "node:zlib";

export type TestZipEntry = {
  name: string;
  content?: string | Buffer;
  deflate?: boolean;
  encrypted?: boolean;
  /** Declares a different uncompressed size than the real one. */
  declaredSize?: number;
};

/** Writes a minimal zip archive, enough to exercise the reader. */
export const buildZip = (entries: TestZipEntry[]) => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.content ?? "");
    const stored = entry.deflate ? deflateRawSync(data) : data;
    const name = Buffer.from(entry.name);
    const flags = (entry.encrypted ? 1 : 0) | 0x800;
    const method = entry.deflate ? 8 : 0;
    const size = entry.declaredSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, stored);
    centrals.push(central, name);
    offset += local.length + name.length + stored.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};
