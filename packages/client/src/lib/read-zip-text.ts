const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_FILE_HEADER = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

type ZipTextEntry = {
  path: string;
  text: string;
};

type ZipCentralDirectoryEntry = {
  localHeaderOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  filename: string;
};

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const minimumOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset--) {
    if (readUint32(bytes, offset) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

export function isZipFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

export async function readTextFilesFromZip(file: File): Promise<ZipTextEntry[]> {
  const { bytes, entries } = await readZipCentralDirectory(file);
  const textEntries: ZipTextEntry[] = [];
  for (const entry of entries) {
    if (!isPackageTextPath(entry.filename)) continue;
    textEntries.push({
      path: entry.filename.replace(/^\/+/, ""),
      text: await readZipTextEntry(bytes, entry),
    });
  }
  return textEntries;
}

async function readZipCentralDirectory(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const endOffset = findEndOfCentralDirectory(bytes);
  if (endOffset < 0) throw new Error("Invalid zip file");

  const entryCount = readUint16(bytes, endOffset + 10);
  const centralDirectoryOffset = readUint32(bytes, endOffset + 16);
  const decoder = new TextDecoder();
  const entries: ZipCentralDirectoryEntry[] = [];

  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (readUint32(bytes, offset) !== ZIP_CENTRAL_DIRECTORY_FILE_HEADER) {
      throw new Error("Invalid zip central directory");
    }

    const compressionMethod = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const filenameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localHeaderOffset = readUint32(bytes, offset + 42);
    const filename = decoder.decode(bytes.slice(offset + 46, offset + 46 + filenameLength));
    entries.push({ localHeaderOffset, compressedSize, uncompressedSize, compressionMethod, filename });

    offset += 46 + filenameLength + extraLength + commentLength;
  }

  return { bytes, entries };
}

async function readZipTextEntry(
  bytes: Uint8Array,
  entry: ZipCentralDirectoryEntry,
) {
  const headerOffset = entry.localHeaderOffset;
  if (readUint32(bytes, headerOffset) !== ZIP_LOCAL_FILE_HEADER) throw new Error("Invalid zip local file header");
  const filenameLength = readUint16(bytes, headerOffset + 26);
  const extraLength = readUint16(bytes, headerOffset + 28);
  const dataOffset = headerOffset + 30 + filenameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > bytes.length) throw new Error("Zip entry is truncated");
  const compressed = bytes.slice(dataOffset, dataEnd);
  if (entry.compressionMethod === 0) {
    return new TextDecoder().decode(compressed);
  }
  if (entry.compressionMethod === 8) {
    const inflated = await inflateDeflateRaw(compressed, entry);
    return new TextDecoder().decode(inflated);
  }
  throw new Error(`Zip entry ${entry.filename} uses an unsupported compression method.`);
}

async function inflateDeflateRaw(compressed: Uint8Array, entry: ZipCentralDirectoryEntry) {
  const ctor = (globalThis as {
    DecompressionStream?: new (format: string) => {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
    };
  }).DecompressionStream;
  if (!ctor) {
    throw new Error(`Zip entry ${entry.filename} is compressed; export it without compression before importing.`);
  }
  const compressedBuffer = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(compressedBuffer).set(compressed);
  const stream = new Blob([compressedBuffer]).stream().pipeThrough(new ctor("deflate-raw"));
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
  if (entry.uncompressedSize > 0 && inflated.length !== entry.uncompressedSize) {
    throw new Error(`Zip entry ${entry.filename} has an unexpected size.`);
  }
  return inflated;
}

function isPackageTextPath(path: string) {
  const normalized = path.replace(/^\/+/, "").toLowerCase();
  if (!normalized || normalized.endsWith("/")) return false;
  return /\.(json|js|mjs|cjs|css|md|txt|ts|tsx)$/.test(normalized);
}
