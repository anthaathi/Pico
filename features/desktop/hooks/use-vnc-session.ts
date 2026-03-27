import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
    vnc,
} from '@pi-ui/client';

type RemoteDisplayRect = vnc.RemoteDisplayRect;
type RemoteDisplayProtocolEvent = vnc.RemoteDisplayProtocolEvent;
type RemoteDisplaySocketMetrics = vnc.RemoteDisplaySocketMetrics;
type WasmDisplayPipeline = vnc.WasmDisplayPipeline;

export type VncConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'handshaking'
    | 'connected'
    | 'error';

export interface FramebufferUpdateEvent {
    width: number;
    height: number;
    rects: RemoteDisplayRect[];
}

export interface DisplayInitEvent {
    width: number;
    height: number;
    name: string;
}

export interface UseVncSessionOptions {
    wsUrl: string;
    password?: string | null;
    autoConnect?: boolean;
    onFramebufferUpdate?: (event: FramebufferUpdateEvent) => void;
    onDisplayInit?: (event: DisplayInitEvent) => void;
    onClipboard?: (text: string) => void;
    onBell?: () => void;
    onError?: (error: string) => void;
}

export interface UseVncSessionResult {
    connectionState: VncConnectionState;
    error: string | null;
    framebufferWidth: number;
    framebufferHeight: number;
    serverName: string;
    metrics: RemoteDisplaySocketMetrics;
    connect: () => void;
    disconnect: () => void;
    sendPointerEvent: (buttonMask: number, x: number, y: number) => void;
    sendKeyEvent: (down: boolean, keysym: number) => void;
    sendWheelEvent: (deltaY: number, x: number, y: number, baseMask?: number) => void;
}

const RAW_FALLBACK_TIMEOUT_MS = 2200;
const RAW_FALLBACK_ERROR_PATTERN = /unexpected eof|zlib|decompress|protocol|buffer/i;

export function useVncSession(options: UseVncSessionOptions): UseVncSessionResult {
    const [connectionState, setConnectionState] = useState<VncConnectionState>('disconnected');
    const [error, setError] = useState<string | null>(null);
    const [framebufferWidth, setFramebufferWidth] = useState(0);
    const [framebufferHeight, setFramebufferHeight] = useState(0);
    const [serverName, setServerName] = useState('');
    const [metrics, setMetrics] = useState<RemoteDisplaySocketMetrics>({ bytesIn: 0, bytesOut: 0 });

    const optionsRef = useRef(options);
    optionsRef.current = options;

    const transportRef = useRef<vnc.WebSocketRemoteDisplayBoundary | null>(null);
    const protocolRef = useRef<vnc.VncRemoteDisplayProtocol | null>(null);
    const pipelineRef = useRef<WasmDisplayPipeline | null>(null);
    const rawFallbackAttemptedRef = useRef(false);
    const firstFrameReceivedRef = useRef(false);
    const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);

    const cleanupConnection = useCallback(() => {
        if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
        }
        transportRef.current?.dispose();
        transportRef.current = null;
        protocolRef.current = null;
        firstFrameReceivedRef.current = false;
    }, []);

    const connectWithEncodings = useCallback((encodings?: string | null) => {
        if (!mountedRef.current) return;
        cleanupConnection();

        const opts = optionsRef.current;
        setConnectionState('connecting');
        setError(null);

        const protocol = new vnc.VncRemoteDisplayProtocol({
            password: opts.password,
            pipeline: pipelineRef.current ?? undefined,
            decodeRawRect: pipelineRef.current?.decodeRawRectToRgba,
            encodings: encodings ?? undefined,
        });
        protocolRef.current = protocol;

        const transport = new vnc.WebSocketRemoteDisplayBoundary({
            url: opts.wsUrl,
            binaryType: 'arraybuffer',

            onOpen: () => {
                if (!mountedRef.current) return;
                setConnectionState('handshaking');
            },

            onMessage: (msg) => {
                if (!mountedRef.current) return;

                if (msg.kind === 'control') {
                    return;
                }

                if (msg.kind === 'binary') {
                    try {
                        const result = protocol.receive(
                            msg.data instanceof ArrayBuffer ? msg.data : undefined,
                        );

                        for (const out of result.outgoing) {
                            transport.send(out);
                        }

                        for (const event of result.events) {
                            handleProtocolEvent(event);
                        }
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        handleProtocolError(message);
                    }
                }
            },

            onClose: () => {
                if (!mountedRef.current) return;
                setConnectionState('disconnected');
            },

            onError: () => {
                if (!mountedRef.current) return;
                setConnectionState('error');
                setError('WebSocket connection failed');
                optionsRef.current.onError?.('WebSocket connection failed');
            },

            onMetrics: (m) => {
                if (!mountedRef.current) return;
                setMetrics(m);
            },
        });

        transportRef.current = transport;
        transport.connect();

        fallbackTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) return;
            if (!firstFrameReceivedRef.current && !rawFallbackAttemptedRef.current) {
                rawFallbackAttemptedRef.current = true;
                connectWithEncodings('0');
            }
        }, RAW_FALLBACK_TIMEOUT_MS);
    }, [cleanupConnection]);

    const handleProtocolEvent = useCallback((event: RemoteDisplayProtocolEvent) => {
        const opts = optionsRef.current;

        switch (event.type) {
            case 'display-init':
                setConnectionState('connected');
                setFramebufferWidth(event.width);
                setFramebufferHeight(event.height);
                setServerName(event.name ?? '');
                opts.onDisplayInit?.({
                    width: event.width,
                    height: event.height,
                    name: event.name ?? '',
                });
                break;

            case 'framebuffer-update': {
                firstFrameReceivedRef.current = true;
                if (fallbackTimerRef.current) {
                    clearTimeout(fallbackTimerRef.current);
                    fallbackTimerRef.current = null;
                }
                setFramebufferWidth(event.width);
                setFramebufferHeight(event.height);
                opts.onFramebufferUpdate?.({
                    width: event.width,
                    height: event.height,
                    rects: event.rects,
                });
                break;
            }

            case 'clipboard':
                opts.onClipboard?.((event as { text: string }).text);
                break;

            case 'bell':
                opts.onBell?.();
                break;
        }
    }, []);

    const handleProtocolError = useCallback((message: string) => {
        if (!mountedRef.current) return;

        if (RAW_FALLBACK_ERROR_PATTERN.test(message) && !rawFallbackAttemptedRef.current) {
            rawFallbackAttemptedRef.current = true;
            connectWithEncodings('0');
            return;
        }

        setConnectionState('error');
        setError(message);
        optionsRef.current.onError?.(message);
        cleanupConnection();
    }, [connectWithEncodings, cleanupConnection]);

    const connect = useCallback(async () => {
        if (!mountedRef.current) return;
        rawFallbackAttemptedRef.current = false;

        if (Platform.OS === 'web' && !pipelineRef.current) {
            try {
                pipelineRef.current = await vnc.loadRemoteDisplayWasmDecoder();
            } catch {
                pipelineRef.current = null;
            }
        }

        connectWithEncodings(null);
    }, [connectWithEncodings]);

    const disconnect = useCallback(() => {
        cleanupConnection();
        if (mountedRef.current) {
            setConnectionState('disconnected');
            setError(null);
        }
    }, [cleanupConnection]);

    const sendPointerEvent = useCallback((buttonMask: number, x: number, y: number) => {
        const data = vnc.encodeVncPointerEvent(buttonMask, x, y);
        transportRef.current?.send(data);
    }, []);

    const sendKeyEvent = useCallback((down: boolean, keysym: number) => {
        const data = vnc.encodeVncKeyEvent(down, keysym);
        transportRef.current?.send(data);
    }, []);

    const sendWheelEvent = useCallback((deltaY: number, x: number, y: number, baseMask: number = 0) => {
        const events = vnc.buildVncWheelPointerEvents(deltaY, x, y, baseMask);
        for (const data of events) {
            transportRef.current?.send(data);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        if (optionsRef.current.autoConnect !== false) {
            connect();
        }
        return () => {
            mountedRef.current = false;
            cleanupConnection();
        };
    }, []);

    return {
        connectionState,
        error,
        framebufferWidth,
        framebufferHeight,
        serverName,
        metrics,
        connect,
        disconnect,
        sendPointerEvent,
        sendKeyEvent,
        sendWheelEvent,
    };
}
