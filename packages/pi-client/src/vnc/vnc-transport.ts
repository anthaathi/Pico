export type RemoteDisplaySocketMetrics = {
    bytesIn: number;
    bytesOut: number;
};

export type RemoteDisplaySocketMessage =
    | {
        kind: 'control';
        raw: string;
        payload: unknown;
      }
    | {
        kind: 'binary';
        data: ArrayBuffer | Blob;
        size: number;
      };

export interface RemoteDisplaySocketBoundaryOptions {
    url: string;
    binaryType?: BinaryType;
    parseControlMessage?: (text: string) => unknown;
    onOpen?: () => void;
    onMessage?: (message: RemoteDisplaySocketMessage) => void;
    onClose?: () => void;
    onError?: () => void;
    onMetrics?: (metrics: RemoteDisplaySocketMetrics) => void;
}

function defaultParseControlMessage(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function measureOutboundSize(value: unknown): number {
    if (typeof value === 'string') {
        return new TextEncoder().encode(value).byteLength;
    }
    if (value instanceof ArrayBuffer) {
        return value.byteLength;
    }
    if (ArrayBuffer.isView(value)) {
        return value.byteLength;
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        return value.size;
    }
    return 0;
}

function measureInboundSize(value: unknown): number {
    if (typeof value === 'string') {
        return value.length;
    }
    if (value instanceof ArrayBuffer) {
        return value.byteLength;
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        return value.size;
    }
    return Number((value as { size?: number })?.size || 0);
}

export class WebSocketRemoteDisplayBoundary {
    private socket: WebSocket | null = null;
    private disposed = false;
    private readonly options: RemoteDisplaySocketBoundaryOptions;
    private bytesIn = 0;
    private bytesOut = 0;
    private metricsTimer: ReturnType<typeof setTimeout> | null = null;
    private metricsDirty = false;

    constructor(options: RemoteDisplaySocketBoundaryOptions) {
        this.options = options;
    }

    connect(): void {
        if (this.disposed) return;
        try { this.socket?.close?.(); } catch {}
        const socket = new WebSocket(this.options.url);
        socket.binaryType = this.options.binaryType || 'arraybuffer';
        socket.addEventListener('open', () => {
            if (this.disposed || this.socket !== socket) return;
            this.options.onOpen?.();
        });
        socket.addEventListener('message', (event: MessageEvent) => {
            if (this.disposed || this.socket !== socket) return;
            const size = measureInboundSize(event.data);
            this.bytesIn += size;
            this.emitMetrics();
            if (typeof event.data === 'string') {
                const parser = this.options.parseControlMessage || defaultParseControlMessage;
                this.options.onMessage?.({
                    kind: 'control',
                    raw: event.data,
                    payload: parser(event.data),
                });
                return;
            }
            this.options.onMessage?.({
                kind: 'binary',
                data: event.data,
                size,
            });
        });
        socket.addEventListener('close', () => {
            if (this.socket === socket) {
                this.socket = null;
            }
            if (this.disposed) return;
            this.options.onClose?.();
        });
        socket.addEventListener('error', () => {
            if (this.disposed || this.socket !== socket) return;
            this.options.onError?.();
        });
        this.socket = socket;
    }

    send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
        if (this.disposed || !this.socket) return;
        const size = measureOutboundSize(data);
        this.bytesOut += size;
        this.emitMetrics();
        this.socket.send(data as Parameters<WebSocket['send']>[0]);
    }

    sendControl(payload: unknown): void {
        this.send(JSON.stringify(payload ?? {}));
    }

    getMetrics(): RemoteDisplaySocketMetrics {
        return {
            bytesIn: this.bytesIn,
            bytesOut: this.bytesOut,
        };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.metricsTimer) {
            clearTimeout(this.metricsTimer);
            this.metricsTimer = null;
        }
        this.options.onMetrics?.(this.getMetrics());
        try { this.socket?.close?.(); } catch {}
        this.socket = null;
    }

    private emitMetrics(): void {
        this.metricsDirty = true;
        if (this.metricsTimer) return;
        this.metricsTimer = setTimeout(() => {
            this.metricsTimer = null;
            if (this.metricsDirty && !this.disposed) {
                this.metricsDirty = false;
                this.options.onMetrics?.(this.getMetrics());
            }
        }, 1000);
    }
}
