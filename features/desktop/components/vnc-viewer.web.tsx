import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { vnc } from '@pi-ui/client';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    useVncSession,
    type FramebufferUpdateEvent,
    type DisplayInitEvent,
} from '../hooks/use-vnc-session';

interface VncViewerProps {
    serverUrl: string;
    accessToken: string;
    vncPort: number;
    vncPassword?: string | null;
    onToggleFullscreen?: (fullscreen: boolean) => void;
}

export function VncViewer({
    serverUrl,
    accessToken,
    vncPort,
    vncPassword,
    onToggleFullscreen,
}: VncViewerProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const containerRef = useRef<View>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);

    const buttonMaskRef = useRef(0);
    const pressedKeysymsRef = useRef(new Map<string, number>());
    const [isFullscreen, setIsFullscreen] = useState(false);

    const wsUrl = useMemo(() => {
        const url = new URL(serverUrl);
        const wsScheme = url.protocol === 'https:' ? 'wss' : 'ws';
        return `${wsScheme}://${url.host}/api/desktop/ws?access_token=${encodeURIComponent(accessToken)}`;
    }, [serverUrl, accessToken]);

    const handleFramebufferUpdate = useCallback((event: FramebufferUpdateEvent) => {
        const ctx = ctxRef.current;
        const canvas = canvasRef.current;
        if (!ctx || !canvas) return;

        if (canvas.width !== event.width || canvas.height !== event.height) {
            canvas.width = event.width;
            canvas.height = event.height;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            updateCanvasScale();
        }

        for (const rect of event.rects) {
            if (rect.kind === 'rgba') {
                const view = new Uint8ClampedArray(rect.rgba.buffer, rect.rgba.byteOffset, rect.rgba.byteLength);
                const img = new ImageData(view, rect.width, rect.height);
                ctx.putImageData(img, rect.x, rect.y);
            } else if (rect.kind === 'copy') {
                const data = ctx.getImageData(rect.srcX, rect.srcY, rect.width, rect.height);
                ctx.putImageData(data, rect.x, rect.y);
            } else if (rect.kind === 'resize') {
                canvas.width = rect.width;
                canvas.height = rect.height;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                updateCanvasScale();
            }
        }
    }, []);

    const handleDisplayInit = useCallback((event: DisplayInitEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = event.width;
        canvas.height = event.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctxRef.current = ctx;
        }
        updateCanvasScale();
    }, []);

    const session = useVncSession({
        wsUrl,
        password: vncPassword,
        autoConnect: true,
        onFramebufferUpdate: handleFramebufferUpdate,
        onDisplayInit: handleDisplayInit,
    });

    const updateCanvasScale = useCallback(() => {
        const canvas = canvasRef.current;
        const stage = stageRef.current;
        if (!canvas || !stage) return;
        const availW = stage.clientWidth;
        const availH = stage.clientHeight;
        if (canvas.width === 0 || canvas.height === 0) return;
        const scale = vnc.computeContainedRemoteDisplayScale(
            availW, availH, canvas.width, canvas.height,
        );
        canvas.style.width = `${Math.round(canvas.width * scale)}px`;
        canvas.style.height = `${Math.round(canvas.height * scale)}px`;
    }, []);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const observer = new ResizeObserver(() => updateCanvasScale());
        observer.observe(stage);
        return () => observer.disconnect();
    }, [updateCanvasScale]);

    const getFramebufferPoint = useCallback((clientX: number, clientY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return vnc.mapClientToFramebufferPoint(
            clientX, clientY,
            { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            session.framebufferWidth,
            session.framebufferHeight,
        );
    }, [session.framebufferWidth, session.framebufferHeight]);

    const handlePointerMove = useCallback((e: PointerEvent) => {
        const { x, y } = getFramebufferPoint(e.clientX, e.clientY);
        session.sendPointerEvent(buttonMaskRef.current, x, y);
    }, [getFramebufferPoint, session]);

    const handlePointerDown = useCallback((e: PointerEvent) => {
        e.preventDefault();
        const bit = vnc.vncButtonMaskForPointerButton(e.button);
        buttonMaskRef.current |= bit;
        const { x, y } = getFramebufferPoint(e.clientX, e.clientY);
        session.sendPointerEvent(buttonMaskRef.current, x, y);
        canvasRef.current?.setPointerCapture(e.pointerId);
    }, [getFramebufferPoint, session]);

    const handlePointerUp = useCallback((e: PointerEvent) => {
        const bit = vnc.vncButtonMaskForPointerButton(e.button);
        buttonMaskRef.current &= ~bit;
        const { x, y } = getFramebufferPoint(e.clientX, e.clientY);
        session.sendPointerEvent(buttonMaskRef.current, x, y);
        canvasRef.current?.releasePointerCapture(e.pointerId);
    }, [getFramebufferPoint, session]);

    const handlePointerCancel = useCallback(() => {
        buttonMaskRef.current = 0;
    }, []);

    const handleWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();
        const { x, y } = getFramebufferPoint(e.clientX, e.clientY);
        session.sendWheelEvent(e.deltaY, x, y, buttonMaskRef.current);
    }, [getFramebufferPoint, session]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const keysym = vnc.resolveVncKeysymFromKeyboardEvent({ key: e.key, code: e.code });
        if (keysym == null) return;
        pressedKeysymsRef.current.set(e.code || e.key, keysym);
        session.sendKeyEvent(true, keysym);
    }, [session]);

    const handleKeyUp = useCallback((e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const keysym = pressedKeysymsRef.current.get(e.code || e.key)
            ?? vnc.resolveVncKeysymFromKeyboardEvent({ key: e.key, code: e.code });
        if (keysym == null) return;
        pressedKeysymsRef.current.delete(e.code || e.key);
        session.sendKeyEvent(false, keysym);
    }, [session]);

    const handleBlur = useCallback(() => {
        for (const [key, keysym] of pressedKeysymsRef.current) {
            session.sendKeyEvent(false, keysym);
        }
        pressedKeysymsRef.current.clear();
        buttonMaskRef.current = 0;
    }, [session]);

    const handleContextMenu = useCallback((e: Event) => {
        e.preventDefault();
    }, []);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;

        let canvas = canvasRef.current;
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            canvas.style.cursor = 'none';
            canvas.tabIndex = 0;
            canvas.style.outline = 'none';
            canvasRef.current = canvas;
            const ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctxRef.current = ctx;
            }
            stage.appendChild(canvas);
        }

        canvas.addEventListener('pointermove', handlePointerMove);
        canvas.addEventListener('pointerdown', handlePointerDown);
        canvas.addEventListener('pointerup', handlePointerUp);
        canvas.addEventListener('pointercancel', handlePointerCancel);
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        canvas.addEventListener('keydown', handleKeyDown);
        canvas.addEventListener('keyup', handleKeyUp);
        canvas.addEventListener('blur', handleBlur);
        canvas.addEventListener('contextmenu', handleContextMenu);

        return () => {
            canvas.removeEventListener('pointermove', handlePointerMove);
            canvas.removeEventListener('pointerdown', handlePointerDown);
            canvas.removeEventListener('pointerup', handlePointerUp);
            canvas.removeEventListener('pointercancel', handlePointerCancel);
            canvas.removeEventListener('wheel', handleWheel);
            canvas.removeEventListener('keydown', handleKeyDown);
            canvas.removeEventListener('keyup', handleKeyUp);
            canvas.removeEventListener('blur', handleBlur);
            canvas.removeEventListener('contextmenu', handleContextMenu);
        };
    }, [
        handlePointerMove, handlePointerDown, handlePointerUp,
        handlePointerCancel, handleWheel, handleKeyDown, handleKeyUp,
        handleBlur, handleContextMenu,
    ]);

    const handleFullscreen = useCallback(() => {
        const el = stageRef.current;
        if (!el) return;
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
            setIsFullscreen(false);
            onToggleFullscreen?.(false);
        } else if (el.requestFullscreen) {
            el.requestFullscreen().catch(() => {});
            setIsFullscreen(true);
            onToggleFullscreen?.(true);
        }
    }, [onToggleFullscreen]);

    useEffect(() => {
        const handler = () => {
            const fs = !!document.fullscreenElement;
            setIsFullscreen(fs);
            onToggleFullscreen?.(fs);
        };
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, [onToggleFullscreen]);

    const handleReconnect = useCallback(() => {
        session.disconnect();
        session.connect();
    }, [session]);

    const focusCanvas = useCallback(() => {
        canvasRef.current?.focus();
    }, []);

    const isConnected = session.connectionState === 'connected';
    const isConnecting = session.connectionState === 'connecting' || session.connectionState === 'handshaking';
    const showChrome = !isConnected || session.error;

    return (
        <View style={styles.root}>
            {showChrome && (
                <View style={[styles.chromeBar, { backgroundColor: colors.surfaceRaised, borderBottomColor: colors.border }]}>
                    <Text style={[styles.chromeStatus, { color: colors.textSecondary }]} numberOfLines={1}>
                        {session.connectionState === 'error'
                            ? session.error ?? 'Connection error'
                            : session.connectionState === 'connecting'
                                ? 'Connecting...'
                                : session.connectionState === 'handshaking'
                                    ? 'Handshaking...'
                                    : 'Disconnected'}
                    </Text>
                    {(session.connectionState === 'disconnected' || session.connectionState === 'error') && (
                        <Pressable
                            onPress={handleReconnect}
                            style={({ pressed }) => [
                                styles.chromeButton,
                                { backgroundColor: colors.border, opacity: pressed ? 0.7 : 1 },
                            ]}
                        >
                            <Text style={[styles.chromeButtonText, { color: colors.text }]}>Reconnect</Text>
                        </Pressable>
                    )}
                    {isConnecting && <ActivityIndicator size="small" />}
                </View>
            )}

            <View
                style={styles.stage}
                ref={(ref) => {
                    if (ref) {
                        stageRef.current = ref as unknown as HTMLDivElement;
                    }
                }}
                // @ts-expect-error web-only click handler
                onClick={focusCanvas}
            />

            {isConnected && (
                <View style={[styles.statusBar, { backgroundColor: colors.surfaceRaised, borderTopColor: colors.border }]}>
                    <Text style={[styles.statusText, { color: colors.textSecondary }]} numberOfLines={1}>
                        {session.serverName ? `${session.serverName} — ` : ''}
                        {session.framebufferWidth}x{session.framebufferHeight}
                    </Text>
                    <Text style={[styles.statusText, { color: colors.textTertiary }]}>
                        {formatBytes(session.metrics.bytesIn)} in / {formatBytes(session.metrics.bytesOut)} out
                    </Text>
                    <Pressable
                        onPress={handleFullscreen}
                        style={({ pressed }) => [
                            styles.chromeButton,
                            { backgroundColor: colors.border, opacity: pressed ? 0.7 : 1 },
                        ]}
                    >
                        <Text style={[styles.chromeButtonText, { color: colors.text }]}>
                            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                        </Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#111',
    },
    chromeBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 8,
        borderBottomWidth: 0.5,
    },
    chromeStatus: {
        flex: 1,
        fontSize: 12,
        fontFamily: Fonts.mono,
    },
    chromeButton: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 4,
    },
    chromeButtonText: {
        fontSize: 12,
        fontFamily: Fonts.sansMedium,
    },
    stage: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    statusBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        gap: 12,
        borderTopWidth: 0.5,
    },
    statusText: {
        fontSize: 11,
        fontFamily: Fonts.mono,
    },
});
