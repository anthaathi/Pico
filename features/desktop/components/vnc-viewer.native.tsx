import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
    ActivityIndicator,
    Animated,
    BackHandler,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
    type LayoutChangeEvent,
    type NativeSyntheticEvent,
    type TextInputChangeEventData,
    type TextInputKeyPressEventData,
} from 'react-native';
import {
    Canvas,
    Image,
    Skia,
    AlphaType,
    ColorType,
    type SkImage,
} from '@shopify/react-native-skia';
import {
    GestureDetector,
    Gesture,
    GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-reanimated';
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

const LONG_PRESS_MS = 500;
const MENU_WIDTH = 160;
const TAP_MOVE_THRESHOLD = 8;
const TRACKPAD_SENSITIVITY = 1.5;

export function VncViewer({
    serverUrl,
    accessToken,
    vncPassword,
    onToggleFullscreen,
}: VncViewerProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const [immersive, setImmersive] = useState(false);
    const [kbdVisible, setKbdVisible] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuAnim = useRef(new Animated.Value(0)).current;
    const [skImage, setSkImage] = useState<SkImage | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    const inputRef = useRef<TextInput>(null);
    const lastTextRef = useRef('______');

    const framebufferRef = useRef<Uint8ClampedArray | null>(null);
    const fbWidthRef = useRef(0);
    const fbHeightRef = useRef(0);

    const cursorX = useSharedValue(0);
    const cursorY = useSharedValue(0);
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
    const buttonMask = useSharedValue(0);
    const prevTranslationX = useSharedValue(0);
    const prevTranslationY = useSharedValue(0);
    const prevScrollY = useSharedValue(0);
    const scaleShared = useSharedValue(1);
    const fbWShared = useSharedValue(0);
    const fbHShared = useSharedValue(0);

    const wsUrl = useMemo(() => {
        const url = new URL(serverUrl);
        const wsScheme = url.protocol === 'https:' ? 'wss' : 'ws';
        return `${wsScheme}://${url.host}/api/desktop/ws?access_token=${encodeURIComponent(accessToken)}`;
    }, [serverUrl, accessToken]);

    const blitRect = useCallback((
        fb: Uint8ClampedArray,
        fbW: number,
        rect: { x: number; y: number; width: number; height: number; rgba: Uint8ClampedArray },
    ) => {
        for (let row = 0; row < rect.height; row++) {
            const srcStart = row * rect.width * 4;
            const dstStart = ((rect.y + row) * fbW + rect.x) * 4;
            fb.set(rect.rgba.subarray(srcStart, srcStart + rect.width * 4), dstStart);
        }
    }, []);

    const copyRect = useCallback((
        fb: Uint8ClampedArray,
        fbW: number,
        rect: { x: number; y: number; width: number; height: number; srcX: number; srcY: number },
    ) => {
        const tmp = new Uint8ClampedArray(rect.width * rect.height * 4);
        for (let row = 0; row < rect.height; row++) {
            const srcStart = ((rect.srcY + row) * fbW + rect.srcX) * 4;
            const tmpStart = row * rect.width * 4;
            tmp.set(fb.subarray(srcStart, srcStart + rect.width * 4), tmpStart);
        }
        for (let row = 0; row < rect.height; row++) {
            const dstStart = ((rect.y + row) * fbW + rect.x) * 4;
            const tmpStart = row * rect.width * 4;
            fb.set(tmp.subarray(tmpStart, tmpStart + rect.width * 4), dstStart);
        }
    }, []);

    const buildSkImage = useCallback((fb: Uint8ClampedArray, width: number, height: number): SkImage | null => {
        const data = Skia.Data.fromBytes(new Uint8Array(fb.buffer, fb.byteOffset, fb.byteLength));
        return Skia.Image.MakeImage(
            {
                width,
                height,
                alphaType: AlphaType.Opaque,
                colorType: ColorType.RGBA_8888,
            },
            data,
            width * 4,
        );
    }, []);

    const handleFramebufferUpdate = useCallback((event: FramebufferUpdateEvent) => {
        let fb = framebufferRef.current;
        const fbW = fbWidthRef.current;
        const fbH = fbHeightRef.current;

        if (!fb || fbW !== event.width || fbH !== event.height) {
            fb = new Uint8ClampedArray(event.width * event.height * 4);
            framebufferRef.current = fb;
            fbWidthRef.current = event.width;
            fbHeightRef.current = event.height;
        }

        for (const rect of event.rects) {
            if (rect.kind === 'rgba') {
                blitRect(fb, event.width, rect);
            } else if (rect.kind === 'copy') {
                copyRect(fb, event.width, rect);
            } else if (rect.kind === 'resize') {
                const newFb = new Uint8ClampedArray(rect.width * rect.height * 4);
                framebufferRef.current = newFb;
                fbWidthRef.current = rect.width;
                fbHeightRef.current = rect.height;
                fb = newFb;
            }
        }

        const img = buildSkImage(fb, fbWidthRef.current, fbHeightRef.current);
        if (img) {
            setSkImage(img);
        }
    }, [blitRect, copyRect, buildSkImage]);

    const handleDisplayInit = useCallback((event: DisplayInitEvent) => {
        const fb = new Uint8ClampedArray(event.width * event.height * 4);
        framebufferRef.current = fb;
        fbWidthRef.current = event.width;
        fbHeightRef.current = event.height;
        fbWShared.value = event.width;
        fbHShared.value = event.height;
        cursorX.value = Math.floor(event.width / 2);
        cursorY.value = Math.floor(event.height / 2);
        setCursorPos({ x: Math.floor(event.width / 2), y: Math.floor(event.height / 2) });
    }, [cursorX, cursorY, fbWShared, fbHShared]);

    const session = useVncSession({
        wsUrl,
        password: vncPassword,
        autoConnect: true,
        onFramebufferUpdate: handleFramebufferUpdate,
        onDisplayInit: handleDisplayInit,
    });

    const scale = useMemo(() => {
        if (session.framebufferWidth === 0 || session.framebufferHeight === 0) return 1;
        if (canvasSize.width === 0 || canvasSize.height === 0) return 1;
        const s = vnc.computeContainedRemoteDisplayScale(
            canvasSize.width, canvasSize.height,
            session.framebufferWidth, session.framebufferHeight,
        );
        scaleShared.value = s;
        return s;
    }, [canvasSize, session.framebufferWidth, session.framebufferHeight, scaleShared]);

    const imageLayout = useMemo(() => {
        const w = session.framebufferWidth * scale;
        const h = session.framebufferHeight * scale;
        const x = (canvasSize.width - w) / 2;
        const y = (canvasSize.height - h) / 2;
        return { x, y, width: w, height: h };
    }, [scale, canvasSize, session.framebufferWidth, session.framebufferHeight]);

    const jsSendPointer = useCallback((mask: number, x: number, y: number) => {
        session.sendPointerEvent(mask, x, y);
    }, [session]);

    const jsUpdateCursor = useCallback((x: number, y: number) => {
        setCursorPos({ x, y });
    }, []);

    const jsSendPointerDelayed = useCallback((mask: number, x: number, y: number, delay: number) => {
        setTimeout(() => session.sendPointerEvent(mask, x, y), delay);
    }, [session]);

    const jsSendWheel = useCallback((deltaY: number, x: number, y: number) => {
        session.sendWheelEvent(deltaY, x, y, 0);
    }, [session]);

    const panGesture = useMemo(() =>
        Gesture.Pan()
            .minDistance(0)
            .onStart(() => {
                'worklet';
                prevTranslationX.value = 0;
                prevTranslationY.value = 0;
            })
            .onUpdate((e) => {
                'worklet';
                const deltaX = e.translationX - prevTranslationX.value;
                const deltaY = e.translationY - prevTranslationY.value;
                prevTranslationX.value = e.translationX;
                prevTranslationY.value = e.translationY;
                const s = scaleShared.value;
                cursorX.value += deltaX / s * TRACKPAD_SENSITIVITY;
                cursorY.value += deltaY / s * TRACKPAD_SENSITIVITY;
                cursorX.value = Math.max(0, Math.min(fbWShared.value - 1, cursorX.value));
                cursorY.value = Math.max(0, Math.min(fbHShared.value - 1, cursorY.value));
                const x = Math.floor(cursorX.value);
                const y = Math.floor(cursorY.value);
                runOnJS(jsUpdateCursor)(x, y);
                runOnJS(jsSendPointer)(buttonMask.value, x, y);
            })
            .onEnd(() => {
                'worklet';
                if (buttonMask.value !== 0) {
                    buttonMask.value = 0;
                    runOnJS(jsSendPointer)(0, Math.floor(cursorX.value), Math.floor(cursorY.value));
                }
            }),
        [prevTranslationX, prevTranslationY, scaleShared, cursorX, cursorY, fbWShared, fbHShared, buttonMask, jsUpdateCursor, jsSendPointer],
    );

    const tapGesture = useMemo(() =>
        Gesture.Tap()
            .maxDuration(250)
            .maxDistance(TAP_MOVE_THRESHOLD)
            .onEnd(() => {
                'worklet';
                const x = Math.floor(cursorX.value);
                const y = Math.floor(cursorY.value);
                runOnJS(jsSendPointer)(1, x, y);
                runOnJS(jsSendPointerDelayed)(0, x, y, 50);
            }),
        [cursorX, cursorY, jsSendPointer, jsSendPointerDelayed],
    );

    const longPressGesture = useMemo(() =>
        Gesture.LongPress()
            .minDuration(LONG_PRESS_MS)
            .onStart(() => {
                'worklet';
                const x = Math.floor(cursorX.value);
                const y = Math.floor(cursorY.value);
                runOnJS(jsSendPointer)(4, x, y);
                runOnJS(jsSendPointerDelayed)(0, x, y, 100);
            }),
        [cursorX, cursorY, jsSendPointer, jsSendPointerDelayed],
    );

    const twoFingerPanGesture = useMemo(() =>
        Gesture.Pan()
            .minPointers(2)
            .maxPointers(2)
            .onStart(() => {
                'worklet';
                prevScrollY.value = 0;
            })
            .onUpdate((e) => {
                'worklet';
                const deltaY = e.translationY - prevScrollY.value;
                prevScrollY.value = e.translationY;
                if (Math.abs(deltaY) > 2) {
                    const x = Math.floor(cursorX.value);
                    const y = Math.floor(cursorY.value);
                    runOnJS(jsSendWheel)(deltaY, x, y);
                }
            }),
        [prevScrollY, cursorX, cursorY, jsSendWheel],
    );

    const composedGesture = useMemo(() =>
        Gesture.Race(
            twoFingerPanGesture,
            Gesture.Exclusive(longPressGesture, tapGesture, panGesture),
        ),
        [panGesture, tapGesture, longPressGesture, twoFingerPanGesture],
    );

    const layoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleCanvasLayout = useCallback((e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = setTimeout(() => {
            setCanvasSize((prev) => {
                if (prev.width === Math.round(width) && prev.height === Math.round(height)) return prev;
                return { width: Math.round(width), height: Math.round(height) };
            });
        }, 150);
    }, []);

    const handleToggleKeyboard = useCallback(() => {
        const next = !kbdVisible;
        setKbdVisible(next);
        if (next) {
            setTimeout(() => inputRef.current?.focus(), 50);
        } else {
            inputRef.current?.blur();
        }
    }, [kbdVisible]);

    const handleToggleFullscreen = useCallback(() => {
        StatusBar.setHidden(!immersive, 'fade');
        const next = !immersive;
        setImmersive(next);
        onToggleFullscreen?.(next);
    }, [immersive, onToggleFullscreen]);

    const handleTextChange = useCallback((e: NativeSyntheticEvent<TextInputChangeEventData>) => {
        const newText = e.nativeEvent.text;
        const oldText = lastTextRef.current;

        if (newText.length > oldText.length) {
            const added = newText.slice(oldText.length);
            for (const ch of added) {
                const code = ch.codePointAt(0);
                if (code != null) {
                    const keysym = code <= 0xff ? code : (0x01000000 | code) >>> 0;
                    session.sendKeyEvent(true, keysym);
                    session.sendKeyEvent(false, keysym);
                }
            }
        } else if (newText.length < oldText.length) {
            const deleted = oldText.length - newText.length;
            for (let i = 0; i < deleted; i++) {
                session.sendKeyEvent(true, 0xff08);
                session.sendKeyEvent(false, 0xff08);
            }
        }

        lastTextRef.current = newText;
    }, [session]);

    const handleKeyPress = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        const { key } = e.nativeEvent;
        const keysym = vnc.resolveVncKeysymFromKeyboardEvent({ key });
        if (keysym != null && vnc.KEYSYM_BY_KEY[key]) {
            session.sendKeyEvent(true, keysym);
            session.sendKeyEvent(false, keysym);
        }
    }, [session]);

    const handleInputBlur = useCallback(() => {
        if (kbdVisible) {
            setKbdVisible(false);
        }
    }, [kbdVisible]);

    const handleReconnect = useCallback(() => {
        session.disconnect();
        session.connect();
    }, [session]);

    const toggleMenu = useCallback(() => {
        const next = !menuOpen;
        setMenuOpen(next);
        Animated.spring(menuAnim, {
            toValue: next ? 1 : 0,
            tension: 300,
            friction: 26,
            useNativeDriver: true,
        }).start();
    }, [menuOpen, menuAnim]);

    useEffect(() => {
        const handler = () => {
            if (menuOpen) {
                toggleMenu();
                return true;
            }
            if (kbdVisible) {
                setKbdVisible(false);
                inputRef.current?.blur();
                return true;
            }
            if (immersive) {
                StatusBar.setHidden(false, 'fade');
                setImmersive(false);
                onToggleFullscreen?.(false);
                return true;
            }
            return false;
        };
        const sub = BackHandler.addEventListener('hardwareBackPress', handler);
        return () => sub.remove();
    }, [kbdVisible, immersive, menuOpen, onToggleFullscreen, toggleMenu]);

    const isConnected = session.connectionState === 'connected';
    const isConnecting = session.connectionState === 'connecting' || session.connectionState === 'handshaking';
    const showChrome = !isConnected || !!session.error;

    return (
        <GestureHandlerRootView style={styles.root}>
            <KeyboardAvoidingView
                style={styles.root}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                {showChrome && (
                    <View style={[styles.chromeBar, { backgroundColor: colors.surfaceRaised, borderBottomColor: colors.border }]}>
                        <Text style={[styles.chromeStatus, { color: colors.textSecondary }]} numberOfLines={1}>
                            {session.connectionState === 'error'
                                ? session.error ?? 'Connection error'
                                : isConnecting
                                    ? 'Connecting...'
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

                <View style={styles.canvasContainer} onLayout={handleCanvasLayout}>
                    <GestureDetector gesture={composedGesture}>
                        <View style={StyleSheet.absoluteFill}>
                            <Canvas style={StyleSheet.absoluteFill}>
                                {skImage && (
                                    <Image
                                        image={skImage}
                                        x={imageLayout.x}
                                        y={imageLayout.y}
                                        width={imageLayout.width}
                                        height={imageLayout.height}
                                        fit="fill"
                                    />
                                )}

                            </Canvas>
                        </View>
                    </GestureDetector>
                </View>

                {isConnected && (
                    <>
                        <Animated.View
                            style={[
                                styles.menuPanel,
                                {
                                    backgroundColor: 'rgba(25,25,25,0.92)',
                                    transform: [{
                                        translateX: menuAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [-MENU_WIDTH, 0],
                                        }),
                                    }],
                                },
                            ]}
                        >
                            <Pressable
                                onPress={handleToggleKeyboard}
                                style={({ pressed }) => [
                                    styles.menuItem,
                                    kbdVisible && { backgroundColor: 'rgba(255,255,255,0.12)' },
                                    pressed && { backgroundColor: 'rgba(255,255,255,0.08)' },
                                ]}
                            >
                                <Text style={[styles.menuItemText, kbdVisible && { color: '#4fc3f7' }]}>
                                    Keyboard
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={handleToggleFullscreen}
                                style={({ pressed }) => [
                                    styles.menuItem,
                                    pressed && { backgroundColor: 'rgba(255,255,255,0.08)' },
                                ]}
                            >
                                <Text style={styles.menuItemText}>
                                    {immersive ? 'Exit Fullscreen' : 'Fullscreen'}
                                </Text>
                            </Pressable>
                            <View style={styles.menuDivider} />
                            <Pressable
                                onPress={handleReconnect}
                                style={({ pressed }) => [
                                    styles.menuItem,
                                    pressed && { backgroundColor: 'rgba(255,255,255,0.08)' },
                                ]}
                            >
                                <Text style={styles.menuItemText}>Reconnect</Text>
                            </Pressable>
                            <View style={styles.menuDivider} />
                            <Text style={styles.menuInfo}>
                                {session.framebufferWidth}x{session.framebufferHeight}
                            </Text>
                        </Animated.View>
                        <Pressable
                            onPress={toggleMenu}
                            style={[
                                styles.menuToggle,
                                menuOpen && styles.menuToggleOpen,
                            ]}
                        >
                            <Text style={styles.menuToggleText}>
                                {menuOpen ? '\u25C0' : '\u25B6'}
                            </Text>
                        </Pressable>
                    </>
                )}

                <TextInput
                    ref={inputRef}
                    style={styles.hiddenInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    blurOnSubmit={false}
                    multiline
                    onChange={handleTextChange}
                    onKeyPress={handleKeyPress}
                    onBlur={handleInputBlur}
                    defaultValue="______"
                />
            </KeyboardAvoidingView>
        </GestureHandlerRootView>
    );
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
    canvasContainer: {
        flex: 1,
        backgroundColor: '#000',
    },
    menuPanel: {
        position: 'absolute',
        left: 0,
        top: '50%',
        marginTop: -100,
        width: MENU_WIDTH,
        borderTopRightRadius: 10,
        borderBottomRightRadius: 10,
        paddingVertical: 6,
        zIndex: 200,
    },
    menuItem: {
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    menuItemText: {
        color: '#ccc',
        fontSize: 13,
        fontFamily: Fonts.sans,
    },
    menuDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: 'rgba(255,255,255,0.1)',
        marginHorizontal: 10,
        marginVertical: 2,
    },
    menuInfo: {
        color: '#666',
        fontSize: 11,
        fontFamily: Fonts.mono,
        paddingHorizontal: 14,
        paddingVertical: 6,
    },
    menuToggle: {
        position: 'absolute',
        left: 0,
        top: '50%',
        marginTop: -28,
        width: 24,
        height: 56,
        backgroundColor: 'rgba(30,30,30,0.7)',
        borderTopRightRadius: 8,
        borderBottomRightRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 201,
    },
    menuToggleOpen: {
        left: MENU_WIDTH,
    },
    menuToggleText: {
        color: '#aaa',
        fontSize: 12,
    },
    hiddenInput: {
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: 1,
        height: 1,
        opacity: 0.01,
        fontSize: 16,
    },
});
