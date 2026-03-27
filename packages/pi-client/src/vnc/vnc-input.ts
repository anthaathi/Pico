function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function encodeVncPointerEvent(buttonMask: number, x: number, y: number): Uint8Array {
    const buffer = new Uint8Array(6);
    const safeX = clamp(Math.floor(Number(x || 0)), 0, 0xffff);
    const safeY = clamp(Math.floor(Number(y || 0)), 0, 0xffff);
    buffer[0] = 5;
    buffer[1] = clamp(Math.floor(Number(buttonMask || 0)), 0, 0xff);
    buffer[2] = (safeX >> 8) & 0xff;
    buffer[3] = safeX & 0xff;
    buffer[4] = (safeY >> 8) & 0xff;
    buffer[5] = safeY & 0xff;
    return buffer;
}

export function vncButtonMaskForPointerButton(button: number): number {
    switch (Number(button)) {
        case 0: return 1;
        case 1: return 2;
        case 2: return 4;
        default: return 0;
    }
}

export interface CanvasRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export function mapClientToFramebufferPoint(
    clientX: number,
    clientY: number,
    rect: CanvasRect,
    framebufferWidth: number,
    framebufferHeight: number,
): { x: number; y: number } {
    const width = Math.max(1, Math.floor(Number(framebufferWidth || 0)));
    const height = Math.max(1, Math.floor(Number(framebufferHeight || 0)));
    const rectWidth = Math.max(1, Number(rect?.width || 0));
    const rectHeight = Math.max(1, Number(rect?.height || 0));
    const relX = (Number(clientX || 0) - Number(rect?.left || 0)) / rectWidth;
    const relY = (Number(clientY || 0) - Number(rect?.top || 0)) / rectHeight;
    return {
        x: clamp(Math.floor(relX * width), 0, Math.max(0, width - 1)),
        y: clamp(Math.floor(relY * height), 0, Math.max(0, height - 1)),
    };
}

export function buildVncWheelPointerEvents(
    deltaY: number,
    x: number,
    y: number,
    baseMask: number = 0,
): Uint8Array[] {
    const wheelBit = Number(deltaY) < 0 ? 8 : 16;
    const pressedMask = clamp((Number(baseMask || 0) | wheelBit), 0, 0xff);
    return [
        encodeVncPointerEvent(pressedMask, x, y),
        encodeVncPointerEvent(Number(baseMask || 0), x, y),
    ];
}

export function encodeVncKeyEvent(down: boolean, keysym: number): Uint8Array {
    const buffer = new Uint8Array(8);
    const safeKeysym = Math.max(0, Math.min(0xffffffff, Number(keysym || 0) >>> 0));
    buffer[0] = 4;
    buffer[1] = down ? 1 : 0;
    buffer[4] = (safeKeysym >>> 24) & 0xff;
    buffer[5] = (safeKeysym >>> 16) & 0xff;
    buffer[6] = (safeKeysym >>> 8) & 0xff;
    buffer[7] = safeKeysym & 0xff;
    return buffer;
}

export function normalizeVncPassword(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return value.length > 0 ? value : null;
}

export function computeContainedRemoteDisplayScale(
    availableWidth: number,
    availableHeight: number,
    framebufferWidth: number,
    framebufferHeight: number,
): number {
    const safeAvailableWidth = Math.max(1, Math.floor(Number(availableWidth || 0)));
    const safeAvailableHeight = Math.max(1, Math.floor(Number(availableHeight || 0)));
    const safeFramebufferWidth = Math.max(1, Math.floor(Number(framebufferWidth || 0)));
    const safeFramebufferHeight = Math.max(1, Math.floor(Number(framebufferHeight || 0)));
    const scale = Math.min(safeAvailableWidth / safeFramebufferWidth, safeAvailableHeight / safeFramebufferHeight);
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    return Math.max(0.01, scale);
}

const KEYSYM_BY_KEY: Record<string, number> = {
    Backspace: 0xff08,
    Tab: 0xff09,
    Enter: 0xff0d,
    Escape: 0xff1b,
    Insert: 0xff63,
    Delete: 0xffff,
    Home: 0xff50,
    End: 0xff57,
    PageUp: 0xff55,
    PageDown: 0xff56,
    ArrowLeft: 0xff51,
    ArrowUp: 0xff52,
    ArrowRight: 0xff53,
    ArrowDown: 0xff54,
    Shift: 0xffe1,
    ShiftLeft: 0xffe1,
    ShiftRight: 0xffe2,
    Control: 0xffe3,
    ControlLeft: 0xffe3,
    ControlRight: 0xffe4,
    Alt: 0xffe9,
    AltLeft: 0xffe9,
    AltRight: 0xffea,
    Meta: 0xffeb,
    MetaLeft: 0xffeb,
    MetaRight: 0xffec,
    Super: 0xffeb,
    Super_L: 0xffeb,
    Super_R: 0xffec,
    CapsLock: 0xffe5,
    NumLock: 0xff7f,
    ScrollLock: 0xff14,
    Pause: 0xff13,
    PrintScreen: 0xff61,
    ContextMenu: 0xff67,
    Menu: 0xff67,
    ' ': 0x20,
};

for (let i = 1; i <= 12; i += 1) {
    KEYSYM_BY_KEY[`F${i}`] = 0xffbe + (i - 1);
}

export interface KeyboardEventLike {
    key?: string;
    code?: string;
}

export function resolveVncKeysymFromKeyboardEvent(event: KeyboardEventLike): number | null {
    const candidates = [event?.key, event?.code];
    for (const candidate of candidates) {
        if (candidate && Object.prototype.hasOwnProperty.call(KEYSYM_BY_KEY, candidate)) {
            return KEYSYM_BY_KEY[candidate];
        }
    }

    const key = String(event?.key || '');
    const keyCodePoint = key ? key.codePointAt(0) : null;
    const keyUnitLength = keyCodePoint == null ? 0 : (keyCodePoint > 0xffff ? 2 : 1);
    if (keyCodePoint != null && key.length === keyUnitLength) {
        if (keyCodePoint <= 0xff) return keyCodePoint;
        return (0x01000000 | keyCodePoint) >>> 0;
    }

    return null;
}

export { KEYSYM_BY_KEY };
