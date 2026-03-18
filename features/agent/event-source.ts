export interface EventSourceEvent {
  type: string;
  data?: string;
  lastEventId?: string | null;
  url?: string;
  message?: string;
  xhrStatus?: number;
  xhrState?: number;
}

type Listener = (event: EventSourceEvent) => void;

interface EventSourceOptions {
  headers?: Record<string, string | { toString(): string }>;
  pollingInterval?: number;
  timeoutBeforeConnection?: number;
  body?: string;
  method?: string;
}

export default class EventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = EventSource.CONNECTING;

  private url: string;
  private headers: Record<string, string | { toString(): string }>;
  private method: string;
  private body: string | undefined;
  private lastEventId: string | null = null;
  private lastIndexProcessed = 0;
  private lineEnding: string | null = null;
  private xhr: XMLHttpRequest | null = null;
  private didFireError = false;

  private listeners: Record<string, Listener[]> = {
    open: [],
    message: [],
    error: [],
    close: [],
  };

  constructor(
    url: string | { toString(): string },
    options: EventSourceOptions = {},
  ) {
    this.url = typeof url === "string" ? url : url.toString();
    this.headers = options.headers ?? {};
    this.method = options.method ?? "GET";
    this.body = options.body;

    const delay = options.timeoutBeforeConnection ?? 0;
    if (delay > 0) {
      setTimeout(() => this.open(), delay);
    } else {
      this.open();
    }
  }

  private open() {
    if (this.readyState === EventSource.CLOSED) return;

    this.readyState = EventSource.CONNECTING;
    this.lastIndexProcessed = 0;
    this.lineEnding = null;
    this.didFireError = false;

    const xhr = new XMLHttpRequest();
    this.xhr = xhr;
    xhr.open(this.method, this.url, true);
    xhr.setRequestHeader("Accept", "text/event-stream");
    xhr.setRequestHeader("Cache-Control", "no-cache");
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");

    for (const [key, value] of Object.entries(this.headers)) {
      xhr.setRequestHeader(
        key,
        typeof value === "string" ? value : value.toString(),
      );
    }

    if (this.lastEventId !== null) {
      xhr.setRequestHeader("Last-Event-ID", this.lastEventId);
    }

    xhr.onreadystatechange = () => {
      if (this.readyState === EventSource.CLOSED) return;

      if (
        xhr.readyState !== XMLHttpRequest.HEADERS_RECEIVED &&
        xhr.readyState !== XMLHttpRequest.LOADING &&
        xhr.readyState !== XMLHttpRequest.DONE
      ) {
        return;
      }

      if (xhr.status >= 200 && xhr.status < 400) {
        if (this.readyState === EventSource.CONNECTING) {
          this.readyState = EventSource.OPEN;
          this.dispatch("open", { type: "open" });
        }
        if (
          xhr.readyState === XMLHttpRequest.LOADING ||
          xhr.readyState === XMLHttpRequest.DONE
        ) {
          this.processChunk(xhr.responseText ?? "");
        }
      } else if (xhr.status !== 0) {
        this.emitError(xhr.responseText, xhr.status, xhr.readyState);
      }
    };

    xhr.onerror = () => {
      if (this.readyState === EventSource.CLOSED) return;
      this.emitError("Network request failed", xhr.status, xhr.readyState);
    };

    xhr.ontimeout = () => {
      if (this.readyState === EventSource.CLOSED) return;
      this.emitError("Connection timed out", 0, xhr.readyState);
    };

    xhr.onloadend = () => {
      if (this.readyState === EventSource.CLOSED) return;
      if (!this.didFireError) {
        this.emitError("Network request failed", 0, XMLHttpRequest.DONE);
      }
    };

    if (this.body) {
      xhr.send(this.body);
    } else {
      xhr.send();
    }
  }

  private emitError(message: string, status: number, state: number) {
    if (this.didFireError) return;
    this.didFireError = true;
    this.readyState = EventSource.CONNECTING;
    this.dispatch("error", {
      type: "error",
      message,
      xhrStatus: status,
      xhrState: state,
    });
  }

  private processChunk(response: string) {
    if (this.lineEnding === null) {
      if (response.includes("\r\n")) this.lineEnding = "\r\n";
      else if (response.includes("\n")) this.lineEnding = "\n";
      else if (response.includes("\r")) this.lineEnding = "\r";
      else return;
    }

    const sep = this.lineEnding + this.lineEnding;
    const lastDouble = response.lastIndexOf(sep);
    if (lastDouble === -1 || lastDouble + sep.length <= this.lastIndexProcessed) {
      return;
    }

    const chunk = response.substring(
      this.lastIndexProcessed,
      lastDouble + sep.length,
    );
    this.lastIndexProcessed = lastDouble + sep.length;

    const blocks = chunk.split(sep);
    for (const block of blocks) {
      if (!block.trim()) continue;
      this.parseBlock(block);
    }
  }

  private parseBlock(block: string) {
    const lines = block.split(/\r?\n|\r/);
    let eventType: string | undefined;
    let id: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith(":")) continue;

      const colonIdx = line.indexOf(":");
      let field: string;
      let val: string;
      if (colonIdx === -1) {
        field = line;
        val = "";
      } else {
        field = line.slice(0, colonIdx);
        val = line.slice(colonIdx + 1).replace(/^ /, "");
      }

      switch (field) {
        case "event":
          eventType = val;
          break;
        case "data":
          dataLines.push(val);
          break;
        case "id":
          if (!val.includes("\0")) id = val;
          break;
      }
    }

    if (dataLines.length === 0) return;

    if (id !== undefined) {
      this.lastEventId = id || null;
    }

    const type = eventType || "message";
    this.dispatch(type, {
      type,
      data: dataLines.join("\n"),
      lastEventId: this.lastEventId,
      url: this.url,
    });
  }

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }
  }

  removeAllEventListeners(type?: string) {
    if (type === undefined) {
      for (const key of Object.keys(this.listeners)) {
        this.listeners[key] = [];
      }
    } else if (this.listeners[type]) {
      this.listeners[type] = [];
    }
  }

  private dispatch(type: string, event: EventSourceEvent) {
    const list = this.listeners[type];
    if (!list) return;
    for (const listener of list) {
      listener(event);
    }
  }

  close() {
    if (this.readyState !== EventSource.CLOSED) {
      this.readyState = EventSource.CLOSED;
      this.dispatch("close", { type: "close" });
    }
    if (this.xhr) {
      this.xhr.abort();
      this.xhr = null;
    }
  }
}
