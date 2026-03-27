const IP_TABLE = [
    58, 50, 42, 34, 26, 18, 10, 2,
    60, 52, 44, 36, 28, 20, 12, 4,
    62, 54, 46, 38, 30, 22, 14, 6,
    64, 56, 48, 40, 32, 24, 16, 8,
    57, 49, 41, 33, 25, 17, 9, 1,
    59, 51, 43, 35, 27, 19, 11, 3,
    61, 53, 45, 37, 29, 21, 13, 5,
    63, 55, 47, 39, 31, 23, 15, 7,
];

const FP_TABLE = [
    40, 8, 48, 16, 56, 24, 64, 32,
    39, 7, 47, 15, 55, 23, 63, 31,
    38, 6, 46, 14, 54, 22, 62, 30,
    37, 5, 45, 13, 53, 21, 61, 29,
    36, 4, 44, 12, 52, 20, 60, 28,
    35, 3, 43, 11, 51, 19, 59, 27,
    34, 2, 42, 10, 50, 18, 58, 26,
    33, 1, 41, 9, 49, 17, 57, 25,
];

const E_TABLE = [
    32, 1, 2, 3, 4, 5,
    4, 5, 6, 7, 8, 9,
    8, 9, 10, 11, 12, 13,
    12, 13, 14, 15, 16, 17,
    16, 17, 18, 19, 20, 21,
    20, 21, 22, 23, 24, 25,
    24, 25, 26, 27, 28, 29,
    28, 29, 30, 31, 32, 1,
];

const P_TABLE = [
    16, 7, 20, 21,
    29, 12, 28, 17,
    1, 15, 23, 26,
    5, 18, 31, 10,
    2, 8, 24, 14,
    32, 27, 3, 9,
    19, 13, 30, 6,
    22, 11, 4, 25,
];

const PC1_TABLE = [
    57, 49, 41, 33, 25, 17, 9,
    1, 58, 50, 42, 34, 26, 18,
    10, 2, 59, 51, 43, 35, 27,
    19, 11, 3, 60, 52, 44, 36,
    63, 55, 47, 39, 31, 23, 15,
    7, 62, 54, 46, 38, 30, 22,
    14, 6, 61, 53, 45, 37, 29,
    21, 13, 5, 28, 20, 12, 4,
];

const PC2_TABLE = [
    14, 17, 11, 24, 1, 5,
    3, 28, 15, 6, 21, 10,
    23, 19, 12, 4, 26, 8,
    16, 7, 27, 20, 13, 2,
    41, 52, 31, 37, 47, 55,
    30, 40, 51, 45, 33, 48,
    44, 49, 39, 56, 34, 53,
    46, 42, 50, 36, 29, 32,
];

const ROTATIONS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const S_BOXES: number[][][] = [
    [
        [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
        [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
        [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
        [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
    ],
    [
        [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
        [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
        [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
        [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
    ],
    [
        [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
        [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
        [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
        [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
    ],
    [
        [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
        [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
        [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
        [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
    ],
    [
        [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
        [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
        [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
        [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
    ],
    [
        [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
        [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
        [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
        [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
    ],
    [
        [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
        [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
        [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
        [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
    ],
    [
        [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
        [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2],
        [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
        [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
    ],
];

const REVERSED_BITS = new Uint8Array(256);
for (let value = 0; value < 256; value += 1) {
    let reversed = 0;
    for (let bit = 0; bit < 8; bit += 1) {
        reversed = (reversed << 1) | ((value >> bit) & 1);
    }
    REVERSED_BITS[value] = reversed;
}

function toUint8Array(bytes: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new Uint8Array(0);
}

function bytesToBigInt(bytes: Uint8Array | ArrayBuffer | ArrayBufferView): bigint {
    let value = 0n;
    const source = toUint8Array(bytes);
    for (const byte of source) {
        value = (value << 8n) | BigInt(byte);
    }
    return value;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
    const out = new Uint8Array(length);
    let remaining = BigInt(value);
    for (let index = length - 1; index >= 0; index -= 1) {
        out[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return out;
}

function permuteBits(input: bigint, table: number[], inputBitLength: number): bigint {
    let output = 0n;
    for (const position of table) {
        const bit = (BigInt(input) >> BigInt(inputBitLength - position)) & 1n;
        output = (output << 1n) | bit;
    }
    return output;
}

function rotateLeft28(value: bigint, amount: number): bigint {
    const width = 28n;
    const mask = (1n << width) - 1n;
    const shift = BigInt(amount % 28);
    return ((value << shift) | (value >> (width - shift))) & mask;
}

function buildDesSubkeys(keyBytes: Uint8Array): bigint[] {
    const key56 = permuteBits(bytesToBigInt(keyBytes), PC1_TABLE, 64);
    let left = (key56 >> 28n) & 0x0fffffffn;
    let right = key56 & 0x0fffffffn;
    const subkeys: bigint[] = [];
    for (const rotation of ROTATIONS) {
        left = rotateLeft28(left, rotation);
        right = rotateLeft28(right, rotation);
        const combined = (left << 28n) | right;
        subkeys.push(permuteBits(combined, PC2_TABLE, 56));
    }
    return subkeys;
}

function applySBoxes(value48: bigint): bigint {
    let output = 0n;
    for (let index = 0; index < 8; index += 1) {
        const shift = BigInt((7 - index) * 6);
        const chunk = Number((value48 >> shift) & 0x3fn);
        const row = ((chunk & 0x20) >> 4) | (chunk & 0x01);
        const column = (chunk >> 1) & 0x0f;
        output = (output << 4n) | BigInt(S_BOXES[index][row][column]);
    }
    return output;
}

function desFeistel(right32: bigint, subkey48: bigint): bigint {
    const expanded = permuteBits(right32, E_TABLE, 32) ^ BigInt(subkey48);
    const substituted = applySBoxes(expanded);
    return permuteBits(substituted, P_TABLE, 32);
}

function encryptDesBlock(blockBytes: Uint8Array, keyBytes: Uint8Array): Uint8Array {
    const subkeys = buildDesSubkeys(keyBytes);
    const initial = permuteBits(bytesToBigInt(blockBytes), IP_TABLE, 64);
    let left = (initial >> 32n) & 0xffffffffn;
    let right = initial & 0xffffffffn;

    for (const subkey of subkeys) {
        const nextLeft = right;
        const nextRight = (left ^ desFeistel(right, subkey)) & 0xffffffffn;
        left = nextLeft;
        right = nextRight;
    }

    const preoutput = (right << 32n) | left;
    return bigIntToBytes(permuteBits(preoutput, FP_TABLE, 64), 8);
}

export function buildVncPasswordKey(password: string | null | undefined): Uint8Array {
    const text = String(password ?? '');
    const key = new Uint8Array(8);
    for (let index = 0; index < 8; index += 1) {
        const codeUnit = index < text.length ? (text.charCodeAt(index) & 0xff) : 0;
        key[index] = REVERSED_BITS[codeUnit];
    }
    return key;
}

export function buildVncPasswordAuthResponse(password: string | null | undefined, challenge: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
    const challengeBytes = toUint8Array(challenge);
    if (challengeBytes.byteLength !== 16) {
        throw new Error(`Invalid VNC auth challenge length ${challengeBytes.byteLength}; expected 16 bytes.`);
    }
    const key = buildVncPasswordKey(password);
    const response = new Uint8Array(16);
    response.set(encryptDesBlock(challengeBytes.slice(0, 8), key), 0);
    response.set(encryptDesBlock(challengeBytes.slice(8, 16), key), 8);
    return response;
}
