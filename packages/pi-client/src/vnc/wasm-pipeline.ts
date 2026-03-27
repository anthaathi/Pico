import type { ASUtil } from '@assemblyscript/loader';
import type { RemoteDisplayPixelFormat } from './protocol';
import type { WasmDisplayPipeline } from './rfb-protocol';

const WASM_URL = '/wasm/remote-display-decoder.wasm';

interface DecoderExports extends ASUtil, Record<string, unknown> {
    memory: WebAssembly.Memory;
    initFramebuffer(width: number, height: number): void;
    getFramebufferPtr(): number;
    getFramebufferLen(): number;
    getFramebufferWidth(): number;
    getFramebufferHeight(): number;
    processRawRect(
        dataBuffer: number, x: number, y: number, w: number, h: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    processCopyRect(
        dstX: number, dstY: number, w: number, h: number,
        srcX: number, srcY: number,
    ): number;
    processRreRect(
        dataBuffer: number, x: number, y: number, w: number, h: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    processHextileRect(
        dataBuffer: number, x: number, y: number, w: number, h: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    processZrleTileData(
        decompressedBuffer: number, x: number, y: number, w: number, h: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    decodeRawRectToRgba(
        srcBuffer: number, width: number, height: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    __pin(ptr: number): number;
    __unpin(ptr: number): void;
    __collect(): void;
    __newArrayBuffer(buf: ArrayBuffer): number;
    __getArrayBuffer(ptr: number): ArrayBuffer;
}

const REQUIRED_EXPORTS = [
    'initFramebuffer', 'getFramebufferPtr', 'getFramebufferLen',
    'getFramebufferWidth', 'getFramebufferHeight',
    'processRawRect', 'processCopyRect', 'processRreRect',
    'processHextileRect', 'processZrleTileData',
    'decodeRawRectToRgba',
] as const;

let pipelinePromise: Promise<WasmDisplayPipeline | null> | null = null;
const GC_INTERVAL_MS = 1000;
const GC_PENDING_BYTES_THRESHOLD = 4 * 1024 * 1024;

function normalizeInput(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
    if (bytes instanceof ArrayBuffer) return bytes;
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer as ArrayBuffer;
    }
    return bytes.slice().buffer as ArrayBuffer;
}

function callProcess(
    ex: DecoderExports,
    fnName: keyof DecoderExports,
    data: Uint8Array,
    x: number,
    y: number,
    w: number,
    h: number,
    pf: RemoteDisplayPixelFormat,
    afterProcess?: (weight: number) => void,
): number {
    const input = normalizeInput(data);
    const ptr = ex.__pin(ex.__newArrayBuffer(input));
    try {
        return (ex[fnName] as Function)(
            ptr, x, y, w, h,
            pf.bitsPerPixel,
            pf.bigEndian ? 1 : 0,
            pf.trueColor ? 1 : 0,
            pf.redMax, pf.greenMax, pf.blueMax,
            pf.redShift, pf.greenShift, pf.blueShift,
        );
    } finally {
        ex.__unpin(ptr);
        afterProcess?.(input.byteLength);
    }
}

export async function loadRemoteDisplayWasmDecoder(
    wasmUrl: string = WASM_URL,
): Promise<WasmDisplayPipeline | null> {
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async (): Promise<WasmDisplayPipeline | null> => {
        try {
            const loader = await import('@assemblyscript/loader');
            const response = await fetch(wasmUrl, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const instantiated = typeof loader.instantiateStreaming === 'function'
                ? await loader.instantiateStreaming<DecoderExports>(response, {})
                : await loader.instantiate<DecoderExports>(await response.arrayBuffer(), {});
            const ex = instantiated.exports as DecoderExports;
            let pendingGcBytes = 0;
            let lastGcAt = Date.now();

            const maybeCollect = (weight: number = 0) => {
                pendingGcBytes += weight;
                const now = Date.now();
                if (pendingGcBytes < GC_PENDING_BYTES_THRESHOLD && now - lastGcAt < GC_INTERVAL_MS) {
                    return;
                }
                pendingGcBytes = 0;
                lastGcAt = now;
                try { ex.__collect?.(); } catch {}
            };

            for (const fn of REQUIRED_EXPORTS) {
                if (typeof ex[fn] !== 'function') throw new Error(`${fn} export is missing.`);
            }

            return {
                initFramebuffer(width: number, height: number): void {
                    ex.initFramebuffer(width, height);
                },

                readFramebufferRect(x: number, y: number, width: number, height: number): Uint8ClampedArray {
                    const fbWidth = ex.getFramebufferWidth();
                    const fbHeight = ex.getFramebufferHeight();
                    const startX = Math.max(0, Math.min(fbWidth, Math.floor(x)));
                    const startY = Math.max(0, Math.min(fbHeight, Math.floor(y)));
                    const copyWidth = Math.max(0, Math.min(Math.floor(width), fbWidth - startX));
                    const copyHeight = Math.max(0, Math.min(Math.floor(height), fbHeight - startY));
                    if (copyWidth === 0 || copyHeight === 0) {
                        return new Uint8ClampedArray(0);
                    }
                    const ptr = ex.getFramebufferPtr();
                    const framebuffer = new Uint8Array(ex.memory.buffer, ptr, ex.getFramebufferLen());
                    const rowBytes = copyWidth * 4;
                    const stride = fbWidth * 4;
                    const region = new Uint8ClampedArray(copyWidth * copyHeight * 4);
                    for (let row = 0; row < copyHeight; row += 1) {
                        const srcStart = ((startY + row) * stride) + (startX * 4);
                        const dstStart = row * rowBytes;
                        region.set(framebuffer.subarray(srcStart, srcStart + rowBytes), dstStart);
                    }
                    return region;
                },

                processRawRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: RemoteDisplayPixelFormat): void {
                    callProcess(ex, 'processRawRect', data, x, y, w, h, pf, maybeCollect);
                },

                processCopyRect(dstX: number, dstY: number, w: number, h: number, srcX: number, srcY: number): void {
                    ex.processCopyRect(dstX, dstY, w, h, srcX, srcY);
                },

                processRreRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: RemoteDisplayPixelFormat): void {
                    callProcess(ex, 'processRreRect', data, x, y, w, h, pf, maybeCollect);
                },

                processHextileRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: RemoteDisplayPixelFormat): void {
                    callProcess(ex, 'processHextileRect', data, x, y, w, h, pf, maybeCollect);
                },

                processZrleTileData(data: Uint8Array, x: number, y: number, w: number, h: number, pf: RemoteDisplayPixelFormat): void {
                    callProcess(ex, 'processZrleTileData', data, x, y, w, h, pf, maybeCollect);
                },

                decodeRawRectToRgba(data: Uint8Array, width: number, height: number, pf: RemoteDisplayPixelFormat): Uint8ClampedArray {
                    const input = normalizeInput(data);
                    const inputPtr = ex.__pin(ex.__newArrayBuffer(input));
                    try {
                        const outputPtr = ex.__pin(ex.decodeRawRectToRgba(
                            inputPtr, width, height,
                            pf.bitsPerPixel,
                            pf.bigEndian ? 1 : 0,
                            pf.trueColor ? 1 : 0,
                            pf.redMax, pf.greenMax, pf.blueMax,
                            pf.redShift, pf.greenShift, pf.blueShift,
                        ));
                        try {
                            return new Uint8ClampedArray(ex.__getArrayBuffer(outputPtr));
                        } finally { ex.__unpin(outputPtr); }
                    } finally {
                        ex.__unpin(inputPtr);
                        maybeCollect(input.byteLength + (width * height * 4));
                    }
                },
            };
        } catch (error) {
            console.warn('[remote-display] Failed to load WASM pipeline, using JS fallback.', error);
            return null;
        }
    })();
    return pipelinePromise;
}

export function resetWasmPipelineCache(): void {
    pipelinePromise = null;
}
