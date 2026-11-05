// Minimal ZIP writer used by the share bundle.
//
// The share bundle must stay dependency-free (no archiver/npm install), so this
// module writes a regular PKZIP archive directly: local file headers, a central
// directory and the end-of-central-directory record. Entries are deflated when
// that makes them smaller and stored otherwise.

import { deflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const VERSION_NEEDED = 20; // 2.0 — deflate support
const UTF8_FLAG = 0x0800;

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }

    return table;
})();

function crc32(buffer) {
    let checksum = 0xffffffff;

    for (let index = 0; index < buffer.length; index++) {
        checksum = CRC_TABLE[(checksum ^ buffer[index]) & 0xff] ^ (checksum >>> 8);
    }

    return (checksum ^ 0xffffffff) >>> 0;
}

/** MS-DOS time/date pair, as required by the ZIP local and central headers. */
function toDosDateTime(date) {
    const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = Math.max(1980, value.getFullYear());

    return {
        time:
            (value.getHours() << 11) |
            (value.getMinutes() << 5) |
            Math.floor(value.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate()
    };
}

function normalizeEntryName(name) {
    const normalized = String(name || "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");

    const segments = normalized.split("/");

    if (segments.length === 0 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
        throw new Error(`Invalid ZIP entry name: "${name}".`);
    }

    return segments.join("/");
}

function toBuffer(data) {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof Uint8Array) return Buffer.from(data);
    return Buffer.from(String(data ?? ""), "utf8");
}

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, data: Buffer|Uint8Array|string, mtime?: Date}>} entries
 * @param {Object} [options]
 * @param {Date} [options.now] - fixed timestamp (deterministic archives in tests)
 * @returns {Buffer}
 */
export function createZip(entries, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const parts = [];
    const fileRecords = [];

    let offset = 0;

    for (const entry of entries) {
        const name = normalizeEntryName(entry.name);
        const data = toBuffer(entry.data);
        const deflated = deflateRawSync(data, { level: 9 });
        const useDeflate = deflated.length < data.length;
        const payload = useDeflate ? deflated : data;
        const method = useDeflate ? METHOD_DEFLATED : METHOD_STORED;
        const checksum = crc32(data);
        const timestamp = toDosDateTime(entry.mtime || now);
        const nameBuffer = Buffer.from(name, "utf8");

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
        localHeader.writeUInt16LE(VERSION_NEEDED, 4);
        localHeader.writeUInt16LE(UTF8_FLAG, 6);
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(timestamp.time, 10);
        localHeader.writeUInt16LE(timestamp.date, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(payload.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        parts.push(localHeader, nameBuffer, payload);

        fileRecords.push({
            nameBuffer,
            checksum,
            method,
            time: timestamp.time,
            date: timestamp.date,
            compressedSize: payload.length,
            uncompressedSize: data.length,
            offset
        });

        offset += localHeader.length + nameBuffer.length + payload.length;
    }

    const centralDirectoryOffset = offset;
    let centralDirectorySize = 0;

    for (const record of fileRecords) {
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
        centralHeader.writeUInt16LE(VERSION_NEEDED, 4);
        centralHeader.writeUInt16LE(VERSION_NEEDED, 6);
        centralHeader.writeUInt16LE(UTF8_FLAG, 8);
        centralHeader.writeUInt16LE(record.method, 10);
        centralHeader.writeUInt16LE(record.time, 12);
        centralHeader.writeUInt16LE(record.date, 14);
        centralHeader.writeUInt32LE(record.checksum, 16);
        centralHeader.writeUInt32LE(record.compressedSize, 20);
        centralHeader.writeUInt32LE(record.uncompressedSize, 24);
        centralHeader.writeUInt16LE(record.nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30); // extra field length
        centralHeader.writeUInt16LE(0, 32); // comment length
        centralHeader.writeUInt16LE(0, 34); // disk number
        centralHeader.writeUInt16LE(0, 36); // internal attributes
        centralHeader.writeUInt32LE(0, 38); // external attributes
        centralHeader.writeUInt32LE(record.offset, 42);

        parts.push(centralHeader, record.nameBuffer);
        centralDirectorySize += centralHeader.length + record.nameBuffer.length;
    }

    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
    endRecord.writeUInt16LE(0, 4); // this disk
    endRecord.writeUInt16LE(0, 6); // disk with central directory
    endRecord.writeUInt16LE(fileRecords.length, 8);
    endRecord.writeUInt16LE(fileRecords.length, 10);
    endRecord.writeUInt32LE(centralDirectorySize, 12);
    endRecord.writeUInt32LE(centralDirectoryOffset, 16);
    endRecord.writeUInt16LE(0, 20); // archive comment length

    parts.push(endRecord);

    return Buffer.concat(parts);
}
