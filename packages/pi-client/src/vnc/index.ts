export type {
    RemoteDisplayPixelFormat,
    RemoteDisplayRect,
    RemoteDisplayProtocolEvent,
    RemoteDisplayProtocolReceiveResult,
    RemoteDisplayProtocolAdapter,
} from './protocol';

export {
    VncRemoteDisplayProtocol,
    decodeRawRectToRgba,
    DEFAULT_CLIENT_PIXEL_FORMAT,
} from './rfb-protocol';

export type {
    WasmDisplayPipeline,
    VncProtocolOptions,
    RawRectDecoder,
} from './rfb-protocol';

export {
    buildVncPasswordKey,
    buildVncPasswordAuthResponse,
} from './vnc-auth';

export {
    encodeVncPointerEvent,
    encodeVncKeyEvent,
    vncButtonMaskForPointerButton,
    mapClientToFramebufferPoint,
    buildVncWheelPointerEvents,
    computeContainedRemoteDisplayScale,
    normalizeVncPassword,
    resolveVncKeysymFromKeyboardEvent,
    KEYSYM_BY_KEY,
} from './vnc-input';

export type {
    CanvasRect,
    KeyboardEventLike,
} from './vnc-input';

export {
    WebSocketRemoteDisplayBoundary,
} from './vnc-transport';

export type {
    RemoteDisplaySocketMetrics,
    RemoteDisplaySocketMessage,
    RemoteDisplaySocketBoundaryOptions,
} from './vnc-transport';

export {
    loadRemoteDisplayWasmDecoder,
    resetWasmPipelineCache,
} from './wasm-pipeline';
