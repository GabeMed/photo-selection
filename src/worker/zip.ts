export interface ZipEntry {
  name: string;
  modifiedAt: Date;
  open: () => Promise<ReadableStream<Uint8Array>>;
}

const encoder = new TextEncoder();
const STORED = 0;
const VERSION_NEEDED = 20;
// Bit 3: CRC and sizes follow the data (they are unknown while streaming). Bit 11: UTF-8 names.
const FLAGS = 0x0808;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32Update(crc: number, chunk: Uint8Array): number {
  for (let index = 0; index < chunk.length; index++) crc = CRC_TABLE[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: (Math.max(date.getUTCFullYear() - 1980, 0) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

type Field = [bytes: 2 | 4, value: number];

function record(fields: Field[], tail: Uint8Array = new Uint8Array()): Uint8Array {
  const fixedLength = fields.reduce((length, [bytes]) => length + bytes, 0);
  const buffer = new Uint8Array(fixedLength + tail.length);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  for (const [bytes, value] of fields) {
    if (bytes === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    offset += bytes;
  }
  buffer.set(tail, fixedLength);
  return buffer;
}

interface WrittenEntry {
  name: Uint8Array;
  modifiedAt: Date;
  crc: number;
  size: number;
  offset: number;
}

function localHeader(name: Uint8Array, modifiedAt: Date): Uint8Array {
  const { time, date } = dosDateTime(modifiedAt);
  return record(
    [[4, 0x04034b50], [2, VERSION_NEEDED], [2, FLAGS], [2, STORED], [2, time], [2, date], [4, 0], [4, 0], [4, 0], [2, name.length], [2, 0]],
    name,
  );
}

const dataDescriptor = (crc: number, size: number) => record([[4, 0x08074b50], [4, crc], [4, size], [4, size]]);

function centralHeader(entry: WrittenEntry): Uint8Array {
  const { time, date } = dosDateTime(entry.modifiedAt);
  return record(
    [
      [4, 0x02014b50], [2, VERSION_NEEDED], [2, VERSION_NEEDED], [2, FLAGS], [2, STORED], [2, time], [2, date],
      [4, entry.crc], [4, entry.size], [4, entry.size], [2, entry.name.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0],
      [4, entry.offset],
    ],
    entry.name,
  );
}

const endOfCentralDirectory = (count: number, size: number, offset: number) =>
  record([[4, 0x06054b50], [2, 0], [2, 0], [2, count], [2, count], [4, size], [4, offset], [2, 0]]);

/** Repeated names get a numeric suffix before the extension: `a.jpg`, `a (2).jpg`. */
export function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let copy = 2; taken.has(candidate.toLowerCase()); copy++) candidate = `${stem} (${copy})${extension}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

async function* zipChunks(entries: ZipEntry[]): AsyncGenerator<Uint8Array> {
  const names = uniqueNames(entries.map((entry) => entry.name));
  const written: WrittenEntry[] = [];
  let offset = 0;
  for (const [index, entry] of entries.entries()) {
    const name = encoder.encode(names[index]);
    const header = localHeader(name, entry.modifiedAt);
    yield header;
    let crc = 0xffffffff;
    let size = 0;
    for await (const chunk of await entry.open()) {
      crc = crc32Update(crc, chunk);
      size += chunk.length;
      yield chunk;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    yield dataDescriptor(crc, size);
    written.push({ name, modifiedAt: entry.modifiedAt, crc, size, offset });
    offset += header.length + size + 16;
  }
  let centralSize = 0;
  for (const entry of written) {
    const header = centralHeader(entry);
    centralSize += header.length;
    yield header;
  }
  yield endOfCentralDirectory(written.length, centralSize, offset);
}

/** A ZIP without compression, produced as the entries are read; nothing is buffered. */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const chunks = zipChunks(entries);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) return controller.close();
      controller.enqueue(next.value);
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}
