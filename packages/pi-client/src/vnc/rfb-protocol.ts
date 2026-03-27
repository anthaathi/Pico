import { Unzlib, zlibSync } from 'fflate';

import { buildVncPasswordAuthResponse } from './vnc-auth';

import type {
    RemoteDisplayPixelFormat,
    RemoteDisplayProtocolAdapter,
    RemoteDisplayProtocolEvent,
    RemoteDisplayProtocolReceiveResult,
    RemoteDisplayRect,
} from './protocol';

const PROTOCOL = 'vnc';

function toEncodingValue(value: string | number): number {
    return Number(value);
}

function normalizeEncodings(encodings: number[] | string | null): number[] {
    const raw: (string | number)[] = Array.isArray(encodings)
        ? encodings
        : typeof encodings === 'string'
            ? encodings
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
            : [];
    const values: number[] = [];
    const seen = new Set<number>();
    for (const item of raw) {
        const value = toEncodingValue(item);
        if (!Number.isFinite(value)) continue;
        const normalized = Number(value);
        if (!seen.has(normalized)) {
            values.push(normalized);
            seen.add(normalized);
        }
    }
    if (values.length > 0) return values;
    return [5, 2, 1, 0, -223];
}

function toUint8Array(chunk: Uint8Array | ArrayBuffer | ArrayBufferView | null | undefined): Uint8Array {
    if (chunk instanceof Uint8Array) return chunk;
    if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
    if (chunk != null && ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    return new Uint8Array(0);
}

function concatBytes(a: Uint8Array | ArrayBuffer, b: Uint8Array | ArrayBuffer): Uint8Array {
    const left = toUint8Array(a);
    const right = toUint8Array(b);
    if (!left.byteLength) return new Uint8Array(right);
    if (!right.byteLength) return new Uint8Array(left);
    const merged = new Uint8Array(left.byteLength + right.byteLength);
    merged.set(left, 0);
    merged.set(right, left.byteLength);
    return merged;
}

function concatByteChunks(chunks: (Uint8Array | null | undefined)[]): Uint8Array {
    let total = 0;
    for (const chunk of chunks || []) total += chunk?.byteLength || 0;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks || []) {
        const bytes = toUint8Array(chunk);
        merged.set(bytes, offset);
        offset += bytes.byteLength;
    }
    return merged;
}

type ZrleInflater = (compressed: Uint8Array) => Uint8Array;

function createZrleInflater(): ZrleInflater {
    return (compressed: Uint8Array): Uint8Array => {
        const payload = toUint8Array(compressed);
        try {
            const chunks: Uint8Array[] = [];
            const inflator = new Unzlib((chunk: Uint8Array) => {
                chunks.push(new Uint8Array(chunk));
            });
            inflator.push(payload, true);
            return concatByteChunks(chunks);
        } catch {
            try {
                const fallback = zlibSync(payload);
                return fallback instanceof Uint8Array ? fallback : new Uint8Array(fallback);
            } catch (fallbackError) {
                const message = fallbackError instanceof Error ? fallbackError.message : 'unexpected EOF';
                throw new Error(`unexpected EOF: ${message}`);
            }
        }
    };
}

function asciiBytes(text: string): Uint8Array {
    return new TextEncoder().encode(String(text || ''));
}

function bytesToAscii(bytes: Uint8Array): string {
    return new TextDecoder().decode(toUint8Array(bytes));
}

interface ParsedVersion {
    major: number;
    minor: number;
    text: string;
}

function parseVersionString(text: string): ParsedVersion | null {
    const match = /^RFB (\d{3})\.(\d{3})\n$/.exec(String(text || ''));
    if (!match) return null;
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        text: match[0],
    };
}

function chooseClientVersion(serverVersion: ParsedVersion | null): string {
    if (!serverVersion) return 'RFB 003.008\n';
    if (serverVersion.major > 3 || serverVersion.minor >= 8) return 'RFB 003.008\n';
    if (serverVersion.minor >= 7) return 'RFB 003.007\n';
    return 'RFB 003.003\n';
}

function parsePixelFormat(view: DataView, offset: number = 0): RemoteDisplayPixelFormat {
    return {
        bitsPerPixel: view.getUint8(offset),
        depth: view.getUint8(offset + 1),
        bigEndian: view.getUint8(offset + 2) === 1,
        trueColor: view.getUint8(offset + 3) === 1,
        redMax: view.getUint16(offset + 4, false),
        greenMax: view.getUint16(offset + 6, false),
        blueMax: view.getUint16(offset + 8, false),
        redShift: view.getUint8(offset + 10),
        greenShift: view.getUint8(offset + 11),
        blueShift: view.getUint8(offset + 12),
    };
}

function encodePixelFormat(format: RemoteDisplayPixelFormat): Uint8Array {
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setUint8(0, 0);
    view.setUint8(1, 0);
    view.setUint8(2, 0);
    view.setUint8(3, 0);
    view.setUint8(4, format.bitsPerPixel);
    view.setUint8(5, format.depth);
    view.setUint8(6, format.bigEndian ? 1 : 0);
    view.setUint8(7, format.trueColor ? 1 : 0);
    view.setUint16(8, format.redMax, false);
    view.setUint16(10, format.greenMax, false);
    view.setUint16(12, format.blueMax, false);
    view.setUint8(14, format.redShift);
    view.setUint8(15, format.greenShift);
    view.setUint8(16, format.blueShift);
    return new Uint8Array(buffer);
}

function buildSetEncodings(encodings: number[]): Uint8Array {
    const list = Array.isArray(encodings) ? encodings : [];
    const buffer = new ArrayBuffer(4 + list.length * 4);
    const view = new DataView(buffer);
    view.setUint8(0, 2);
    view.setUint8(1, 0);
    view.setUint16(2, list.length, false);
    let offset = 4;
    for (const encoding of list) {
        view.setInt32(offset, Number(encoding || 0), false);
        offset += 4;
    }
    return new Uint8Array(buffer);
}

function buildFramebufferUpdateRequest(
    incremental: boolean,
    width: number,
    height: number,
    x: number = 0,
    y: number = 0,
): Uint8Array {
    const buffer = new ArrayBuffer(10);
    const view = new DataView(buffer);
    view.setUint8(0, 3);
    view.setUint8(1, incremental ? 1 : 0);
    view.setUint16(2, x, false);
    view.setUint16(4, y, false);
    view.setUint16(6, Math.max(0, width || 0), false);
    view.setUint16(8, Math.max(0, height || 0), false);
    return new Uint8Array(buffer);
}

function scaleChannel(value: number, max: number): number {
    const numericMax = Number(max || 0);
    if (numericMax <= 0) return 0;
    if (numericMax === 255) return value & 0xff;
    return Math.max(0, Math.min(255, Math.round(((value || 0) * 255) / numericMax)));
}

function readPixelValue(bytes: Uint8Array, offset: number, bytesPerPixel: number, bigEndian: boolean): number {
    if (bytesPerPixel === 1) return bytes[offset];
    if (bytesPerPixel === 2) {
        return bigEndian
            ? ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0
            : (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
    }
    if (bytesPerPixel === 3) {
        return bigEndian
            ? ((bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2]) >>> 0
            : (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) >>> 0;
    }
    if (bytesPerPixel === 4) {
        return bigEndian
            ? (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
            : (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | ((bytes[offset + 3] << 24) >>> 0)) >>> 0;
    }
    return 0;
}

export const DEFAULT_CLIENT_PIXEL_FORMAT: RemoteDisplayPixelFormat = {
    bitsPerPixel: 32,
    depth: 24,
    bigEndian: false,
    trueColor: true,
    redMax: 255,
    greenMax: 255,
    blueMax: 255,
    redShift: 16,
    greenShift: 8,
    blueShift: 0,
};

export type RawRectDecoder = (
    bytes: Uint8Array,
    width: number,
    height: number,
    pixelFormat: RemoteDisplayPixelFormat,
) => Uint8ClampedArray;

export function decodeRawRectToRgba(
    bytes: Uint8Array | ArrayBuffer,
    width: number,
    height: number,
    pixelFormat?: RemoteDisplayPixelFormat,
): Uint8ClampedArray {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const src = toUint8Array(bytes);
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    const expected = Math.max(0, width || 0) * Math.max(0, height || 0) * bytesPerPixel;
    if (src.byteLength < expected) {
        throw new Error(`Incomplete raw rectangle payload: expected ${expected} byte(s), got ${src.byteLength}`);
    }
    if (!format.trueColor) {
        throw new Error('Indexed-colour VNC framebuffers are not supported yet.');
    }
    const rgba = new Uint8ClampedArray(Math.max(0, width || 0) * Math.max(0, height || 0) * 4);
    let srcOffset = 0;
    let dstOffset = 0;
    for (let i = 0; i < Math.max(0, width || 0) * Math.max(0, height || 0); i += 1) {
        const value = readPixelValue(src, srcOffset, bytesPerPixel, format.bigEndian);
        const red = scaleChannel((value >>> format.redShift) & format.redMax, format.redMax);
        const green = scaleChannel((value >>> format.greenShift) & format.greenMax, format.greenMax);
        const blue = scaleChannel((value >>> format.blueShift) & format.blueMax, format.blueMax);
        rgba[dstOffset] = red;
        rgba[dstOffset + 1] = green;
        rgba[dstOffset + 2] = blue;
        rgba[dstOffset + 3] = 255;
        srcOffset += bytesPerPixel;
        dstOffset += 4;
    }
    return rgba;
}

interface DecodedPixel {
    rgba: number[];
    bytesPerPixel: number;
}

function decodePixelToRgba(bytes: Uint8Array, offset: number, pixelFormat: RemoteDisplayPixelFormat): DecodedPixel | null {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    if (bytes.byteLength < offset + bytesPerPixel) return null;
    const value = readPixelValue(bytes, offset, bytesPerPixel, format.bigEndian);
    return {
        rgba: [
            scaleChannel((value >>> format.redShift) & format.redMax, format.redMax),
            scaleChannel((value >>> format.greenShift) & format.greenMax, format.greenMax),
            scaleChannel((value >>> format.blueShift) & format.blueMax, format.blueMax),
            255,
        ],
        bytesPerPixel,
    };
}

function fillRgbaRect(
    surface: Uint8ClampedArray,
    surfaceWidth: number,
    x: number,
    y: number,
    width: number,
    height: number,
    rgba: number[] | null | undefined,
): void {
    if (!rgba) return;
    for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
            const dst = ((y + row) * surfaceWidth + (x + col)) * 4;
            surface[dst] = rgba[0];
            surface[dst + 1] = rgba[1];
            surface[dst + 2] = rgba[2];
            surface[dst + 3] = rgba[3];
        }
    }
}

function blitRgbaTile(
    surface: Uint8ClampedArray,
    surfaceWidth: number,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
    tileRgba: Uint8ClampedArray,
): void {
    for (let row = 0; row < tileHeight; row += 1) {
        const srcStart = row * tileWidth * 4;
        const dstStart = ((tileY + row) * surfaceWidth + tileX) * 4;
        surface.set(tileRgba.subarray(srcStart, srcStart + tileWidth * 4), dstStart);
    }
}

interface ZrleRunLength {
    consumed: number;
    runLength: number;
}

function parseZrleRunLength(bytes: Uint8Array, offset: number): ZrleRunLength | null {
    let cursor = offset;
    let runLength = 1;
    while (true) {
        if (bytes.byteLength < cursor + 1) return null;
        const value = bytes[cursor++];
        runLength += value;
        if (value !== 255) break;
    }
    return { consumed: cursor - offset, runLength };
}

interface ZrleRectResult {
    consumed: number;
    rgba?: Uint8ClampedArray;
    decompressed?: Uint8Array;
    skipped?: boolean;
}

function parseZrleRect(
    bytes: Uint8Array,
    offset: number,
    width: number,
    height: number,
    pixelFormat: RemoteDisplayPixelFormat,
    decodeRawRect: RawRectDecoder,
    inflateZrle: ZrleInflater,
): ZrleRectResult | null {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    if (bytes.byteLength < offset + 4) return null;
    const compressedLength = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    if (bytes.byteLength < offset + 4 + compressedLength) return null;
    const compressed = bytes.subarray(offset + 4, offset + 4 + compressedLength);
    let decoded: Uint8Array;
    try {
        decoded = inflateZrle(compressed);
    } catch {
        return {
            consumed: 4 + compressedLength,
            skipped: true,
        };
    }
    let cursor = 0;
    const rgba = new Uint8ClampedArray(Math.max(0, width || 0) * Math.max(0, height || 0) * 4);

    for (let tileY = 0; tileY < height; tileY += 64) {
        const tileHeight = Math.min(64, height - tileY);
        for (let tileX = 0; tileX < width; tileX += 64) {
            const tileWidth = Math.min(64, width - tileX);
            if (decoded.byteLength < cursor + 1) return null;
            const subencoding = decoded[cursor++];
            const paletteSize = subencoding & 0x7f;
            const runLengthEncoded = (subencoding & 0x80) !== 0;

            if (!runLengthEncoded && paletteSize === 0) {
                const rawLength = tileWidth * tileHeight * bytesPerPixel;
                if (decoded.byteLength < cursor + rawLength) return null;
                const tileRgba = decodeRawRect(decoded.subarray(cursor, cursor + rawLength), tileWidth, tileHeight, format);
                cursor += rawLength;
                blitRgbaTile(rgba, width, tileX, tileY, tileWidth, tileHeight, tileRgba);
                continue;
            }

            if (!runLengthEncoded && paletteSize === 1) {
                const background = decodePixelToRgba(decoded, cursor, format);
                if (!background) return null;
                cursor += background.bytesPerPixel;
                fillRgbaRect(rgba, width, tileX, tileY, tileWidth, tileHeight, background.rgba);
                continue;
            }

            if (!runLengthEncoded && paletteSize > 1 && paletteSize <= 16) {
                const palette: number[][] = [];
                for (let i = 0; i < paletteSize; i += 1) {
                    const color = decodePixelToRgba(decoded, cursor, format);
                    if (!color) return null;
                    cursor += color.bytesPerPixel;
                    palette.push(color.rgba);
                }
                const bitsPerIndex = paletteSize <= 2 ? 1 : paletteSize <= 4 ? 2 : 4;
                const rowBytes = Math.ceil((tileWidth * bitsPerIndex) / 8);
                const packedLength = rowBytes * tileHeight;
                if (decoded.byteLength < cursor + packedLength) return null;
                for (let row = 0; row < tileHeight; row += 1) {
                    const rowStart = cursor + row * rowBytes;
                    for (let col = 0; col < tileWidth; col += 1) {
                        const bitIndex = col * bitsPerIndex;
                        const byteIndex = rowStart + (bitIndex >> 3);
                        const shift = 8 - bitsPerIndex - (bitIndex & 7);
                        const paletteIndex = (decoded[byteIndex] >> shift) & ((1 << bitsPerIndex) - 1);
                        fillRgbaRect(rgba, width, tileX + col, tileY + row, 1, 1, palette[paletteIndex]);
                    }
                }
                cursor += packedLength;
                continue;
            }

            if (runLengthEncoded && paletteSize === 0) {
                let px = 0;
                let py = 0;
                while (py < tileHeight) {
                    const color = decodePixelToRgba(decoded, cursor, format);
                    if (!color) return null;
                    cursor += color.bytesPerPixel;
                    const run = parseZrleRunLength(decoded, cursor);
                    if (!run) return null;
                    cursor += run.consumed;
                    for (let i = 0; i < run.runLength; i += 1) {
                        fillRgbaRect(rgba, width, tileX + px, tileY + py, 1, 1, color.rgba);
                        px += 1;
                        if (px >= tileWidth) {
                            px = 0;
                            py += 1;
                            if (py >= tileHeight) break;
                        }
                    }
                }
                continue;
            }

            if (runLengthEncoded && paletteSize > 0) {
                const palette: number[][] = [];
                for (let i = 0; i < paletteSize; i += 1) {
                    const color = decodePixelToRgba(decoded, cursor, format);
                    if (!color) return null;
                    cursor += color.bytesPerPixel;
                    palette.push(color.rgba);
                }
                let px = 0;
                let py = 0;
                while (py < tileHeight) {
                    if (decoded.byteLength < cursor + 1) return null;
                    const indexByte = decoded[cursor++];
                    let paletteIndex = indexByte;
                    let runLength = 1;
                    if (indexByte & 0x80) {
                        paletteIndex = indexByte & 0x7f;
                        const run = parseZrleRunLength(decoded, cursor);
                        if (!run) return null;
                        cursor += run.consumed;
                        runLength = run.runLength;
                    }
                    const color = palette[paletteIndex];
                    if (!color) return null;
                    for (let i = 0; i < runLength; i += 1) {
                        fillRgbaRect(rgba, width, tileX + px, tileY + py, 1, 1, color);
                        px += 1;
                        if (px >= tileWidth) {
                            px = 0;
                            py += 1;
                            if (py >= tileHeight) break;
                        }
                    }
                }
                continue;
            }

            return {
                consumed: 4 + compressedLength,
                skipped: true,
            };
        }
    }

    return {
        consumed: 4 + compressedLength,
        rgba,
        decompressed: decoded,
    };
}

function inflateZrleRect(
    bytes: Uint8Array,
    offset: number,
    inflateZrle: ZrleInflater,
): ZrleRectResult | null {
    if (bytes.byteLength < offset + 4) return null;
    const compressedLength = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    if (bytes.byteLength < offset + 4 + compressedLength) return null;
    try {
        return {
            consumed: 4 + compressedLength,
            decompressed: inflateZrle(bytes.subarray(offset + 4, offset + 4 + compressedLength)),
        };
    } catch {
        return {
            consumed: 4 + compressedLength,
            skipped: true,
        };
    }
}

interface RreRectResult {
    consumed: number;
    rgba: Uint8ClampedArray;
}

interface RectMeasurement {
    consumed: number;
}

function measureRreRect(
    bytes: Uint8Array,
    offset: number,
    pixelFormat: RemoteDisplayPixelFormat,
): RectMeasurement | null {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    if (bytes.byteLength < offset + 4 + bytesPerPixel) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const subrectCount = view.getUint32(0, false);
    const totalSize = 4 + bytesPerPixel + subrectCount * (bytesPerPixel + 8);
    if (bytes.byteLength < offset + totalSize) return null;

    return { consumed: totalSize };
}

function parseRreRect(
    bytes: Uint8Array,
    offset: number,
    width: number,
    height: number,
    pixelFormat: RemoteDisplayPixelFormat,
): RreRectResult | null {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    if (bytes.byteLength < offset + 4 + bytesPerPixel) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const subrectCount = view.getUint32(0, false);
    const totalSize = 4 + bytesPerPixel + subrectCount * (bytesPerPixel + 8);
    if (bytes.byteLength < offset + totalSize) return null;

    let cursor = offset + 4;
    const background = decodePixelToRgba(bytes, cursor, format);
    if (!background) return null;
    cursor += background.bytesPerPixel;

    const rgba = new Uint8ClampedArray(Math.max(0, width || 0) * Math.max(0, height || 0) * 4);
    fillRgbaRect(rgba, width, 0, 0, width, height, background.rgba);

    for (let i = 0; i < subrectCount; i += 1) {
        const color = decodePixelToRgba(bytes, cursor, format);
        if (!color) return null;
        cursor += color.bytesPerPixel;
        if (bytes.byteLength < cursor + 8) return null;
        const rectView = new DataView(bytes.buffer, bytes.byteOffset + cursor, 8);
        const x = rectView.getUint16(0, false);
        const y = rectView.getUint16(2, false);
        const rectWidth = rectView.getUint16(4, false);
        const rectHeight = rectView.getUint16(6, false);
        cursor += 8;
        fillRgbaRect(rgba, width, x, y, rectWidth, rectHeight, color.rgba);
    }

    return {
        consumed: cursor - offset,
        rgba,
    };
}

interface HextileRectResult {
    consumed: number;
    rgba: Uint8ClampedArray;
}

function measureHextileRect(
    bytes: Uint8Array,
    offset: number,
    width: number,
    height: number,
    pixelFormat: RemoteDisplayPixelFormat,
): RectMeasurement | null {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    let cursor = offset;

    for (let tileY = 0; tileY < height; tileY += 16) {
        const tileHeight = Math.min(16, height - tileY);
        for (let tileX = 0; tileX < width; tileX += 16) {
            const tileWidth = Math.min(16, width - tileX);
            if (bytes.byteLength < cursor + 1) return null;
            const subencoding = bytes[cursor++];

            if (subencoding & 0x01) {
                const rawLength = tileWidth * tileHeight * bytesPerPixel;
                if (bytes.byteLength < cursor + rawLength) return null;
                cursor += rawLength;
                continue;
            }

            if (subencoding & 0x02) {
                if (bytes.byteLength < cursor + bytesPerPixel) return null;
                cursor += bytesPerPixel;
            }
            if (subencoding & 0x04) {
                if (bytes.byteLength < cursor + bytesPerPixel) return null;
                cursor += bytesPerPixel;
            }
            if (subencoding & 0x08) {
                if (bytes.byteLength < cursor + 1) return null;
                const subrectCount = bytes[cursor++];
                for (let i = 0; i < subrectCount; i += 1) {
                    if (subencoding & 0x10) {
                        if (bytes.byteLength < cursor + bytesPerPixel) return null;
                        cursor += bytesPerPixel;
                    }
                    if (bytes.byteLength < cursor + 2) return null;
                    cursor += 2;
                }
            }
        }
    }

    return {
        consumed: cursor - offset,
    };
}

function parseHextileRect(
    bytes: Uint8Array,
    offset: number,
    width: number,
    height: number,
    pixelFormat: RemoteDisplayPixelFormat,
    decodeRawRect: RawRectDecoder,
): HextileRectResult | null {
    const format = pixelFormat || DEFAULT_CLIENT_PIXEL_FORMAT;
    const bytesPerPixel = Math.max(1, Math.floor(Number(format.bitsPerPixel || 0) / 8));
    const rgba = new Uint8ClampedArray(Math.max(0, width || 0) * Math.max(0, height || 0) * 4);
    let cursor = offset;
    let background = [0, 0, 0, 255];
    let foreground = [255, 255, 255, 255];

    for (let tileY = 0; tileY < height; tileY += 16) {
        const tileHeight = Math.min(16, height - tileY);
        for (let tileX = 0; tileX < width; tileX += 16) {
            const tileWidth = Math.min(16, width - tileX);
            if (bytes.byteLength < cursor + 1) return null;
            const subencoding = bytes[cursor++];

            if (subencoding & 0x01) {
                const rawLength = tileWidth * tileHeight * bytesPerPixel;
                if (bytes.byteLength < cursor + rawLength) return null;
                const tileRgba = decodeRawRect(bytes.subarray(cursor, cursor + rawLength), tileWidth, tileHeight, format);
                cursor += rawLength;
                blitRgbaTile(rgba, width, tileX, tileY, tileWidth, tileHeight, tileRgba);
                continue;
            }

            if (subencoding & 0x02) {
                const decoded = decodePixelToRgba(bytes, cursor, format);
                if (!decoded) return null;
                background = decoded.rgba;
                cursor += decoded.bytesPerPixel;
            }
            fillRgbaRect(rgba, width, tileX, tileY, tileWidth, tileHeight, background);

            if (subencoding & 0x04) {
                const decoded = decodePixelToRgba(bytes, cursor, format);
                if (!decoded) return null;
                foreground = decoded.rgba;
                cursor += decoded.bytesPerPixel;
            }

            if (subencoding & 0x08) {
                if (bytes.byteLength < cursor + 1) return null;
                const subrectCount = bytes[cursor++];
                for (let i = 0; i < subrectCount; i += 1) {
                    let color = foreground;
                    if (subencoding & 0x10) {
                        const decoded = decodePixelToRgba(bytes, cursor, format);
                        if (!decoded) return null;
                        color = decoded.rgba;
                        cursor += decoded.bytesPerPixel;
                    }
                    if (bytes.byteLength < cursor + 2) return null;
                    const xy = bytes[cursor++];
                    const wh = bytes[cursor++];
                    const subX = xy >> 4;
                    const subY = xy & 0x0f;
                    const subWidth = (wh >> 4) + 1;
                    const subHeight = (wh & 0x0f) + 1;
                    fillRgbaRect(rgba, width, tileX + subX, tileY + subY, subWidth, subHeight, color);
                }
            }
        }
    }

    return {
        consumed: cursor - offset,
        rgba,
    };
}

export interface WasmDisplayPipeline {
    initFramebuffer(width: number, height: number): void;
    readFramebufferRect(x: number, y: number, width: number, height: number): Uint8ClampedArray;
    processRawRect(data: Uint8Array, x: number, y: number, width: number, height: number, pixelFormat: RemoteDisplayPixelFormat): void;
    processCopyRect(x: number, y: number, width: number, height: number, srcX: number, srcY: number): void;
    processRreRect(data: Uint8Array, x: number, y: number, width: number, height: number, pixelFormat: RemoteDisplayPixelFormat): void;
    processHextileRect(data: Uint8Array, x: number, y: number, width: number, height: number, pixelFormat: RemoteDisplayPixelFormat): void;
    processZrleTileData(data: Uint8Array, x: number, y: number, width: number, height: number, pixelFormat: RemoteDisplayPixelFormat): void;
    decodeRawRectToRgba?: RawRectDecoder;
}

export interface VncProtocolOptions {
    password?: string | null;
    shared?: boolean;
    encodings?: number[] | string | null;
    pipeline?: WasmDisplayPipeline | null;
    decodeRawRect?: RawRectDecoder;
    inflateZrle?: ZrleInflater;
}

type VncState =
    | 'version'
    | 'security-types'
    | 'security-type-33'
    | 'security-challenge'
    | 'security-result'
    | 'server-init'
    | 'connected';

export class VncRemoteDisplayProtocol implements RemoteDisplayProtocolAdapter {
    readonly protocol = PROTOCOL;
    state: VncState;
    framebufferWidth: number;
    framebufferHeight: number;
    serverName: string;

    private shared: boolean;
    private decodeRawRect: RawRectDecoder;
    private pipeline: WasmDisplayPipeline | null;
    private encodings: number[];
    private buffer: Uint8Array;
    private readOffset: number;
    private writeOffset: number;
    private serverVersion: ParsedVersion | null;
    private clientVersionText: string | null;
    private serverPixelFormat: RemoteDisplayPixelFormat | null;
    private clientPixelFormat: RemoteDisplayPixelFormat;
    private password: string | null;
    private inflateZrle: ZrleInflater;

    constructor(options: VncProtocolOptions = {}) {
        this.shared = options.shared !== false;
        this.decodeRawRect = typeof options.decodeRawRect === 'function' ? options.decodeRawRect : decodeRawRectToRgba;
        this.pipeline = options.pipeline || null;
        this.encodings = normalizeEncodings(options.encodings || null);
        this.state = 'version';
        this.buffer = new Uint8Array(65536);
        this.readOffset = 0;
        this.writeOffset = 0;
        this.serverVersion = null;
        this.clientVersionText = null;
        this.framebufferWidth = 0;
        this.framebufferHeight = 0;
        this.serverName = '';
        this.serverPixelFormat = null;
        this.clientPixelFormat = { ...DEFAULT_CLIENT_PIXEL_FORMAT };
        this.password = typeof options.password === 'string' && options.password.length > 0 ? options.password : null;
        this.inflateZrle = typeof options.inflateZrle === 'function' ? options.inflateZrle : createZrleInflater();
    }

    receive(chunk?: ArrayBuffer | Uint8Array | null): RemoteDisplayProtocolReceiveResult {
        if (chunk) {
            this.appendToBuffer(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : toUint8Array(chunk));
        }
        const events: RemoteDisplayProtocolEvent[] = [];
        const outgoing: Uint8Array[] = [];
        let progressed = true;
        while (progressed) {
            progressed = false;

            if (this.state === 'version') {
                if (this.available < 12) break;
                const bytes = this.consume(12);
                const text = bytesToAscii(bytes);
                const version = parseVersionString(text);
                if (!version) {
                    throw new Error(`Unsupported RFB version banner: ${text || '<empty>'}`);
                }
                this.serverVersion = version;
                this.clientVersionText = chooseClientVersion(version);
                outgoing.push(asciiBytes(this.clientVersionText));
                events.push({ type: 'protocol-version', protocol: PROTOCOL, server: version.text.trim(), client: this.clientVersionText.trim() });
                this.state = version.minor >= 7 ? 'security-types' : 'security-type-33';
                progressed = true;
                continue;
            }

            if (this.state === 'security-types') {
                if (this.available < 1) break;
                const count = this.buffer[this.readOffset];
                if (count === 0) {
                    if (this.available < 5) break;
                    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.readOffset, this.available);
                    const reasonLength = view.getUint32(1, false);
                    if (this.available < 5 + reasonLength) break;
                    this.readOffset += 1;
                    const reason = bytesToAscii(this.consume(4 + reasonLength).subarray(4));
                    throw new Error(reason || 'VNC server rejected the connection.');
                }
                if (this.available < 1 + count) break;
                this.readOffset += 1;
                const types = Array.from(this.consume(count));
                events.push({ type: 'security-types', protocol: PROTOCOL, types });
                let selectedType: number | null = null;
                if (types.includes(2) && this.password !== null) {
                    selectedType = 2;
                } else if (types.includes(1)) {
                    selectedType = 1;
                } else if (types.includes(2)) {
                    throw new Error('VNC password authentication is required. Enter a password and reconnect.');
                } else {
                    throw new Error(`Unsupported VNC security types: ${types.join(', ') || 'none'}. This viewer currently supports only "None" and password-based VNC auth.`);
                }
                outgoing.push(Uint8Array.of(selectedType));
                events.push({ type: 'security-selected', protocol: PROTOCOL, securityType: selectedType, label: selectedType === 2 ? 'VNC Authentication' : 'None' });
                this.state = selectedType === 2 ? 'security-challenge' : 'security-result';
                progressed = true;
                continue;
            }

            if (this.state === 'security-type-33') {
                if (this.available < 4) break;
                const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.readOffset, this.available);
                const securityType = view.getUint32(0, false);
                this.readOffset += 4;
                if (securityType === 0) {
                    if (this.available < 4) break;
                    const reasonView = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.readOffset, this.available);
                    const reasonLength = reasonView.getUint32(0, false);
                    if (this.available < 4 + reasonLength) break;
                    const reason = bytesToAscii(this.consume(4 + reasonLength).subarray(4));
                    throw new Error(reason || 'VNC server rejected the connection.');
                }
                if (securityType === 2) {
                    if (this.password === null) {
                        throw new Error('VNC password authentication is required. Enter a password and reconnect.');
                    }
                    events.push({ type: 'security-selected', protocol: PROTOCOL, securityType: 2, label: 'VNC Authentication' });
                    this.state = 'security-challenge';
                    progressed = true;
                    continue;
                }
                if (securityType !== 1) {
                    throw new Error(`Unsupported VNC security type ${securityType}. This viewer currently supports only "None" and password-based VNC auth.`);
                }
                events.push({ type: 'security-selected', protocol: PROTOCOL, securityType: 1, label: 'None' });
                outgoing.push(Uint8Array.of(this.shared ? 1 : 0));
                this.state = 'server-init';
                progressed = true;
                continue;
            }

            if (this.state === 'security-challenge') {
                if (this.available < 16) break;
                if (this.password === null) {
                    throw new Error('VNC password authentication is required. Enter a password and reconnect.');
                }
                const challenge = this.consume(16);
                outgoing.push(buildVncPasswordAuthResponse(this.password, challenge));
                this.state = 'security-result';
                progressed = true;
                continue;
            }

            if (this.state === 'security-result') {
                if (this.available < 4) break;
                const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.readOffset, this.available);
                const result = view.getUint32(0, false);
                this.readOffset += 4;
                if (result !== 0) {
                    if (this.available >= 4) {
                        const reasonView = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.readOffset, this.available);
                        const reasonLength = reasonView.getUint32(0, false);
                        if (this.available >= 4 + reasonLength) {
                            const reason = bytesToAscii(this.consume(4 + reasonLength).subarray(4));
                            throw new Error(reason || 'VNC authentication failed.');
                        }
                    }
                    throw new Error('VNC authentication failed.');
                }
                events.push({ type: 'security-result', protocol: PROTOCOL, ok: true });
                outgoing.push(Uint8Array.of(this.shared ? 1 : 0));
                this.state = 'server-init';
                progressed = true;
                continue;
            }

            if (this.state === 'server-init') {
                if (this.available < 24) break;
                const peekView = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.readOffset, this.available);
                const width = peekView.getUint16(0, false);
                const height = peekView.getUint16(2, false);
                const pixelFormat = parsePixelFormat(peekView, 4);
                const nameLength = peekView.getUint32(20, false);
                if (this.available < 24 + nameLength) break;
                const fixed = this.consume(24);
                const fixedView = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength);
                this.framebufferWidth = fixedView.getUint16(0, false);
                this.framebufferHeight = fixedView.getUint16(2, false);
                this.serverPixelFormat = parsePixelFormat(fixedView, 4);
                this.serverName = bytesToAscii(this.consume(nameLength));
                this.state = 'connected';
                if (this.pipeline) {
                    this.pipeline.initFramebuffer(this.framebufferWidth, this.framebufferHeight);
                }
                outgoing.push(encodePixelFormat(this.clientPixelFormat));
                outgoing.push(buildSetEncodings(this.encodings));
                outgoing.push(buildFramebufferUpdateRequest(false, this.framebufferWidth, this.framebufferHeight));
                events.push({
                    type: 'display-init',
                    protocol: PROTOCOL,
                    width,
                    height,
                    name: this.serverName,
                    pixelFormat,
                });
                progressed = true;
                continue;
            }

            if (this.state === 'connected') {
                if (this.available < 1) break;
                const data = this.buffer.subarray(this.readOffset, this.writeOffset);
                const type = data[0];
                if (type === 0) {
                    if (data.byteLength < 4) break;
                    const headerView = new DataView(data.buffer, data.byteOffset, data.byteLength);
                    const numberOfRectangles = headerView.getUint16(2, false);
                    let offset = 4;
                    const rects: RemoteDisplayRect[] = [];
                    let incomplete = false;
                    const usePipeline = !!this.pipeline;
                    for (let i = 0; i < numberOfRectangles; i += 1) {
                        if (data.byteLength < offset + 12) {
                            incomplete = true;
                            break;
                        }
                        const rectView = new DataView(data.buffer, data.byteOffset + offset, 12);
                        const x = rectView.getUint16(0, false);
                        const y = rectView.getUint16(2, false);
                        const width = rectView.getUint16(4, false);
                        const height = rectView.getUint16(6, false);
                        const encoding = rectView.getInt32(8, false);
                        offset += 12;

                        if (encoding === 0) {
                            const bytesPerPixel = Math.max(1, Math.floor(Number(this.clientPixelFormat.bitsPerPixel || 0) / 8));
                            const dataLength = width * height * bytesPerPixel;
                            if (data.byteLength < offset + dataLength) {
                                incomplete = true;
                                break;
                            }
                            const raw = data.subarray(offset, offset + dataLength);
                            offset += dataLength;
                            if (usePipeline) {
                                this.pipeline!.processRawRect(raw, x, y, width, height, this.clientPixelFormat);
                                rects.push({
                                    kind: 'rgba',
                                    x, y, width, height,
                                    rgba: this.pipeline!.readFramebufferRect(x, y, width, height),
                                });
                            } else {
                                rects.push({
                                    kind: 'rgba',
                                    x, y, width, height,
                                    rgba: this.decodeRawRect(raw, width, height, this.clientPixelFormat),
                                });
                            }
                            continue;
                        }

                        if (encoding === 2) {
                            const rre = usePipeline
                                ? measureRreRect(data, offset, this.clientPixelFormat)
                                : parseRreRect(data, offset, width, height, this.clientPixelFormat);
                            if (!rre) {
                                incomplete = true;
                                break;
                            }
                            if (usePipeline) {
                                const rreData = data.subarray(offset, offset + rre.consumed);
                                this.pipeline!.processRreRect(rreData, x, y, width, height, this.clientPixelFormat);
                                rects.push({
                                    kind: 'rgba',
                                    x, y, width, height,
                                    rgba: this.pipeline!.readFramebufferRect(x, y, width, height),
                                });
                            } else {
                                rects.push({ kind: 'rgba', x, y, width, height, rgba: (rre as RreRectResult).rgba });
                            }
                            offset += rre.consumed;
                            continue;
                        }

                        if (encoding === 1) {
                            if (data.byteLength < offset + 4) {
                                incomplete = true;
                                break;
                            }
                            const copyView = new DataView(data.buffer, data.byteOffset + offset, 4);
                            const srcX = copyView.getUint16(0, false);
                            const srcY = copyView.getUint16(2, false);
                            offset += 4;
                            if (usePipeline) {
                                this.pipeline!.processCopyRect(x, y, width, height, srcX, srcY);
                                rects.push({
                                    kind: 'rgba',
                                    x, y, width, height,
                                    rgba: this.pipeline!.readFramebufferRect(x, y, width, height),
                                });
                            } else {
                                rects.push({ kind: 'copy', x, y, width, height, srcX, srcY });
                            }
                            continue;
                        }

                        if (encoding === 16) {
                            const zrle = usePipeline
                                ? inflateZrleRect(data, offset, this.inflateZrle)
                                : parseZrleRect(data, offset, width, height, this.clientPixelFormat, this.decodeRawRect, this.inflateZrle);
                            if (!zrle) {
                                incomplete = true;
                                break;
                            }
                            offset += zrle.consumed;
                            if (zrle.skipped) continue;
                            if (usePipeline && zrle.decompressed) {
                                this.pipeline!.processZrleTileData(zrle.decompressed, x, y, width, height, this.clientPixelFormat);
                                rects.push({
                                    kind: 'rgba',
                                    x, y, width, height,
                                    rgba: this.pipeline!.readFramebufferRect(x, y, width, height),
                                });
                            } else {
                                rects.push({ kind: 'rgba', x, y, width, height, rgba: zrle.rgba! });
                            }
                            continue;
                        }

                        if (encoding === 5) {
                            const hextile = usePipeline
                                ? measureHextileRect(data, offset, width, height, this.clientPixelFormat)
                                : parseHextileRect(data, offset, width, height, this.clientPixelFormat, this.decodeRawRect);
                            if (!hextile) {
                                incomplete = true;
                                break;
                            }
                            if (usePipeline) {
                                const hextileData = data.subarray(offset, offset + hextile.consumed);
                                this.pipeline!.processHextileRect(hextileData, x, y, width, height, this.clientPixelFormat);
                                rects.push({
                                    kind: 'rgba',
                                    x, y, width, height,
                                    rgba: this.pipeline!.readFramebufferRect(x, y, width, height),
                                });
                            } else {
                                rects.push({ kind: 'rgba', x, y, width, height, rgba: (hextile as HextileRectResult).rgba });
                            }
                            offset += hextile.consumed;
                            continue;
                        }

                        if (encoding === -223) {
                            this.framebufferWidth = width;
                            this.framebufferHeight = height;
                            if (usePipeline) {
                                this.pipeline!.initFramebuffer(width, height);
                            }
                            rects.push({ kind: 'resize', x, y, width, height });
                            continue;
                        }
                        throw new Error(`Unsupported VNC rectangle encoding ${encoding}. This viewer currently supports ZRLE, Hextile, RRE, CopyRect, raw rectangles, and DesktopSize only.`);
                    }
                    if (incomplete) break;
                    this.readOffset += offset;

                    const event: RemoteDisplayProtocolEvent = {
                        type: 'framebuffer-update',
                        protocol: PROTOCOL,
                        width: this.framebufferWidth,
                        height: this.framebufferHeight,
                        rects,
                    };
                    events.push(event);
                    outgoing.push(buildFramebufferUpdateRequest(true, this.framebufferWidth, this.framebufferHeight));
                    progressed = true;
                    continue;
                }
                if (type === 2) {
                    this.readOffset += 1;
                    events.push({ type: 'bell', protocol: PROTOCOL });
                    progressed = true;
                    continue;
                }
                if (type === 3) {
                    if (data.byteLength < 8) break;
                    const clipView = new DataView(data.buffer, data.byteOffset, data.byteLength);
                    const length = clipView.getUint32(4, false);
                    if (data.byteLength < 8 + length) break;
                    const text = bytesToAscii(data.subarray(8, 8 + length));
                    this.readOffset += 8 + length;
                    events.push({ type: 'clipboard', protocol: PROTOCOL, text });
                    progressed = true;
                    continue;
                }
                throw new Error(`Unsupported VNC server message type ${type}.`);
            }
        }
        return { events, outgoing };
    }

    private get available(): number {
        return this.writeOffset - this.readOffset;
    }

    private consume(length: number): Uint8Array {
        const start = this.readOffset;
        this.readOffset += length;
        return this.buffer.subarray(start, this.readOffset);
    }

    private appendToBuffer(chunk: Uint8Array): void {
        const chunkLen = chunk.byteLength;
        if (chunkLen === 0) return;

        const freeAtEnd = this.buffer.byteLength - this.writeOffset;
        if (chunkLen > freeAtEnd) {
            const unread = this.writeOffset - this.readOffset;
            if (unread > 0) {
                this.buffer.copyWithin(0, this.readOffset, this.writeOffset);
            }
            this.readOffset = 0;
            this.writeOffset = unread;

            if (chunkLen > this.buffer.byteLength - this.writeOffset) {
                const newSize = Math.max((this.writeOffset + chunkLen) * 2, 65536);
                const newBuf = new Uint8Array(newSize);
                if (this.writeOffset > 0) {
                    newBuf.set(this.buffer.subarray(0, this.writeOffset));
                }
                this.buffer = newBuf;
            }
        }

        this.buffer.set(chunk, this.writeOffset);
        this.writeOffset += chunkLen;
    }
}
