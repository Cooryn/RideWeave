import { invoke } from "@tauri-apps/api/core";
import type { FileEntry, ReadableReader } from "@zip.js/zip.js";

export const maxGpxBytes = 50 * 1024 * 1024;
const zipReadChunkBytes = 1024 * 1024;

export type GpxImportFile = Pick<File, "name" | "text"> & { size?: number };
type ZipImportFile = {
  name: string;
  gpxFiles: () => AsyncIterable<GpxImportFile>;
};
export type ImportFile = GpxImportFile | ZipImportFile;

export const isZip = (name: string) => /\.zip$/i.test(name);
const fileName = (path: string) => path.split(/[\\/]/).at(-1) || path;

export function pickedImportFile(file: File): ImportFile {
  return isZip(file.name)
    ? { name: file.name, gpxFiles: () => readZipGpx(file) }
    : file;
}

export function droppedImportFile(path: string): ImportFile {
  const name = fileName(path);
  return isZip(name)
    ? { name, gpxFiles: () => readZipGpx(path) }
    : { name, text: () => invoke<string>("read_dropped_gpx", { path }) };
}

async function readEntry(entry: FileEntry) {
  let bytes = 0;
  let raw = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  await entry.getData(
    new WritableStream<Uint8Array>({
      write(chunk) {
        bytes += chunk.byteLength;
        if (bytes > maxGpxBytes) throw new Error("文件超过 50 MB 限制");
        raw += decoder.decode(chunk, { stream: true });
      },
    }),
    { checkSignature: true },
  );
  return raw + decoder.decode();
}

async function* readZipGpx(
  source: Blob | string,
): AsyncGenerator<GpxImportFile> {
  const { BlobReader, Reader, ZipReader } =
    await import("@zip.js/zip.js/lib/zip-core-native.js");
  let input: ReadableReader;
  if (typeof source === "string") {
    // Seek into the dropped archive so large unrelated entries stay on disk.
    const reader = new Reader<void>(undefined);
    reader.size = await invoke<number>("open_dropped_zip", { path: source });
    reader.readUint8Array = async (offset, length) => {
      const bytes = new Uint8Array(
        Math.max(0, Math.min(length, reader.size - offset)),
      );
      for (let i = 0; i < bytes.length; i += zipReadChunkBytes) {
        const chunk = await invoke<ArrayBuffer>("read_dropped_zip_range", {
          offset: offset + i,
          length: Math.min(zipReadChunkBytes, bytes.length - i),
        });
        bytes.set(new Uint8Array(chunk), i);
      }
      return bytes;
    };
    input = reader;
  } else {
    input = new BlobReader(source);
  }

  try {
    const zip = new ZipReader(input, { useWebWorkers: false });
    try {
      let found = false;
      for await (const entry of zip.getEntriesGenerator()) {
        if (entry.directory || !/\.gpx$/i.test(entry.filename)) continue;
        found = true;
        yield {
          name: fileName(entry.filename),
          size: entry.uncompressedSize,
          text: () => readEntry(entry),
        };
      }
      if (!found) throw new Error("压缩包内没有 GPX 文件");
    } finally {
      await zip.close();
    }
  } finally {
    if (typeof source === "string") await invoke("close_dropped_zip");
  }
}
