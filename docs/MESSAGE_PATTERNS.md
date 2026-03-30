# SSE Message Patterns

Pi server exposes two SSE endpoints. This document covers every event type, their shapes, and the sequences they appear in.

## Endpoints

| Endpoint | Scope | Hello Event |
|---|---|---|
| `GET /events` | All sessions (global) | `server_hello` |
| `GET /sessions/{id}/stream` | Single session | `session_stream_hello` |

## Event Envelope

Every SSE frame follows standard format:

```
id: 44
data: {"type":"message_start","id":44,"session_id":"...","timestamp":1774267300170,"data":{...},"workspace_id":"..."}
```

Common top-level fields on each `data` JSON:

| Field | Type | Notes |
|---|---|---|
| `type` | string | Event type (see below) |
| `id` | number | Monotonically increasing event ID |
| `session_id` | string | Which session this belongs to (empty for global events) |
| `timestamp` | number | Unix ms |
| `workspace_id` | string | Present on `message_start`/`message_end` |
| `data` | object | Inner payload (shape depends on `type`) |

---

## Connection Events

### `server_hello` (global only)

First event on `/events`. No `id` field.

```json
{"instance_id":"5828d246-...","type":"server_hello"}
```

### `session_stream_hello` (session only)

First event on `/sessions/{id}/stream`. No `id` field.

```json
{"session_id":"c88be712-...","type":"session_stream_hello"}
```

---

## History Replay (session stream only)

Immediately after `session_stream_hello`, the server replays existing messages.

### `history_messages`

Uses SSE `event:` field (not just `data:`):

```
event: history
data: {"id":0,"session_id":"...","type":"history_messages","data":{"has_more":true,"oldest_entry_id":"70b69fd9","messages":[...]}}
```

`data.messages` is an array of full message objects (same shape as `message_start` payloads). Each message has an `entryId` field. Roles include `user`, `assistant`, `toolResult`.

| Field | Type | Notes |
|---|---|---|
| `has_more` | boolean | If true, older messages exist (pagination) |
| `oldest_entry_id` | string | Cursor for fetching older messages |
| `messages` | Message[] | Array of complete messages |

### `history_done`

```
event: history_done
data: {"type":"history_done"}
```

After this, live events begin streaming.

---

## Global-Only Events

### `active_sessions`

List of all active session IDs.

```json
{"type":"active_sessions","data":{"session_ids":["24d61936-...","44b607f2-..."],"type":"active_sessions"}}
```

### `agent_state`

Full snapshot of a session's state. Emitted on connect and when state changes.

```json
{
  "type": "agent_state",
  "data": {
    "sessionId": "44b607f2-...",
    "isStreaming": false,
    "isCompacting": false,
    "messageCount": 63,
    "pendingMessageCount": 0,
    "autoCompactionEnabled": true,
    "followUpMode": "one-at-a-time",
    "steeringMode": "one-at-a-time",
    "thinkingLevel": "high",
    "sessionFile": "/home/omkar/.pi/agent/sessions/.../session.jsonl",
    "model": {
      "id": "claude-opus-4-6",
      "name": "Claude Opus 4 6",
      "provider": "anthropic",
      "api": "anthropic-messages",
      "contextWindow": 200000,
      "maxTokens": 16384,
      "reasoning": true,
      "input": ["text", "image"],
      "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
    }
  }
}
```

### `client_command`

Echoed back when the UI sends a command. Useful for debugging.

```json
{"type":"client_command","data":{"type":"prompt","message":"write a 3 lines file please"}}
{"type":"client_command","data":{"type":"get_state"}}
{"type":"client_command","data":{"type":"get_messages"}}
{"type":"client_command","data":{"type":"get_available_models"}}
{"type":"client_command","data":{"type":"get_commands"}}
{"type":"client_command","data":{"type":"abort"}}
```

### `extension_ui_request`

Extension UI state changes (plan mode, widgets, etc.).

```json
{"type":"extension_ui_request","data":{"id":"...","method":"setStatus","statusKey":"plan-mode","type":"extension_ui_request"}}
{"type":"extension_ui_request","data":{"id":"...","method":"setWidget","widgetKey":"plan-todos","type":"extension_ui_request"}}
```

---

## Session Lifecycle Events

### `session_state`

Streaming flag changes. Appears on both endpoints.

```json
{"type":"session_state","data":{"isStreaming":true,"type":"session_state"}}
{"type":"session_state","data":{"isStreaming":false,"type":"session_state"}}
```

### `agent_start`

Agent begins processing a prompt (global only).

```json
{"type":"agent_start","data":{"type":"agent_start"}}
```

### `agent_end`

Agent finishes. Contains ALL messages from the run (global only).

```json
{
  "type": "agent_end",
  "data": {
    "type": "agent_end",
    "messages": [
      { "role": "user", "content": [...], "timestamp": ... },
      { "role": "assistant", "content": [...], "stopReason": "stop", "usage": {...} }
    ]
  }
}
```

---

## Turn & Message Events

### `turn_start`

A new LLM turn begins. Multiple turns happen when the assistant calls tools (tool result triggers next turn).

```json
{"type":"turn_start","data":{"type":"turn_start"}}
```

### `turn_end`

Turn completes. Contains the final assistant message + tool results (global only).

```json
{
  "type": "turn_end",
  "data": {
    "type": "turn_end",
    "message": {
      "role": "assistant",
      "stopReason": "toolUse",
      "content": [
        { "type": "thinking", "thinking": "...", "thinkingSignature": "..." },
        { "type": "toolCall", "id": "tool_...", "name": "write", "arguments": {...} }
      ],
      "usage": { "input": 66270, "output": 165, "cacheRead": 256, "totalTokens": 66691 }
    },
    "toolResults": [
      { "role": "toolResult", "toolCallId": "tool_...", "toolName": "write", "isError": false, "content": [...] }
    ]
  }
}
```

**`stopReason` values:**

| Value | Meaning |
|---|---|
| `stop` | Natural completion, no more tool calls |
| `toolUse` | Assistant wants to call tool(s), another turn follows |
| `aborted` | User cancelled |

---

## Message Events

### `message_start`

New message arrives. Contains the full message object (content may be empty for assistant streaming).

**User message:**
```json
{
  "type": "message_start",
  "data": {
    "type": "message_start",
    "message": {
      "role": "user",
      "content": [{ "type": "text", "text": "write a 3 lines file please" }],
      "timestamp": 1774267300165
    }
  }
}
```

**Assistant message (start of streaming — content is empty):**
```json
{
  "type": "message_start",
  "data": {
    "type": "message_start",
    "message": {
      "role": "assistant",
      "content": [],
      "model": "claude-opus-4-6",
      "provider": "anthropic",
      "api": "anthropic-messages",
      "stopReason": "stop",
      "timestamp": 1774267355521,
      "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
    }
  }
}
```

**Tool result message:**
```json
{
  "type": "message_start",
  "data": {
    "type": "message_start",
    "message": {
      "role": "toolResult",
      "toolCallId": "tool_gxUDp7...",
      "toolName": "write",
      "isError": false,
      "content": [{ "type": "text", "text": "Successfully wrote 195 bytes to /home/omkar/clanker/three_lines.txt" }],
      "timestamp": 1774267376241
    }
  }
}
```

### `message_end`

Message is complete. For assistant messages, contains the **full** content with thinking, tool calls, text, and usage.

```json
{
  "type": "message_end",
  "data": {
    "type": "message_end",
    "message": {
      "role": "assistant",
      "stopReason": "toolUse",
      "content": [
        { "type": "thinking", "thinking": "The user wants...", "thinkingSignature": "base64..." },
        { "type": "toolCall", "id": "tool_...", "name": "write", "arguments": { "path": "...", "content": "..." } }
      ],
      "model": "kimi-for-coding",
      "provider": "kimi",
      "usage": {
        "input": 66270, "output": 165, "cacheRead": 256,
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 },
        "totalTokens": 66691
      }
    }
  }
}
```

---

## Streaming Deltas (`message_update`)

All streaming deltas share the same outer shape:

```json
{
  "type": "message_update",
  "data": {
    "type": "message_update",
    "assistantMessageEvent": {
      "contentIndex": 0,
      "type": "<subtype>",
      ...
    }
  }
}
```

`contentIndex` identifies which content block is streaming (0 = first block, 1 = second, etc.). This matters for parallel tool calls.

### Thinking

```json
// start
{ "contentIndex": 0, "type": "thinking_start" }

// delta (many)
{ "contentIndex": 0, "type": "thinking_delta", "delta": "The user wants" }

// end
{ "contentIndex": 0, "type": "thinking_end" }
```

### Tool Call

```json
// start
{ "contentIndex": 1, "type": "toolcall_start" }

// delta (many) — streams raw JSON of the arguments
{ "contentIndex": 1, "type": "toolcall_delta", "delta": "{\"path\":" }

// end — contains the parsed tool call
{
  "contentIndex": 1,
  "type": "toolcall_end",
  "toolCall": {
    "id": "tool_gxUDp7SczN5ZLIlxVGWtuygB",
    "name": "write",
    "arguments": { "path": "/home/omkar/clanker/three_lines.txt", "content": "..." }
  }
}
```

### Text

```json
// start
{ "contentIndex": 1, "type": "text_start" }

// delta (many)
{ "contentIndex": 1, "type": "text_delta", "delta": "Done." }

// end — contains full assembled text
{ "contentIndex": 1, "type": "text_end", "content": "Done. Created two 3-line files:\n\n1. ..." }
```

---

## Tool Execution Events

### `tool_execution_start`

Tool begins running. Contains the arguments.

```json
{
  "type": "tool_execution_start",
  "data": {
    "type": "tool_execution_start",
    "toolCallId": "tool_gxUDp7...",
    "toolName": "write",
    "args": { "path": "...", "content": "..." }
  }
}
```

### `tool_execution_update` (session stream only)

Partial output from long-running tools (e.g. `bash`).

```json
{
  "type": "tool_execution_update",
  "data": {
    "type": "tool_execution_update",
    "toolCallId": "toolu_011n...",
    "toolName": "bash",
    "args": { "command": "rm /tmp/quick_a.txt ..." },
    "partialResult": {
      "content": [{ "type": "text", "text": "Deleted all 3\n" }]
    }
  }
}
```

### `tool_execution_end`

Tool finished. Contains the result.

```json
{
  "type": "tool_execution_end",
  "data": {
    "type": "tool_execution_end",
    "toolCallId": "tool_gxUDp7...",
    "toolName": "write",
    "isError": false,
    "result": {
      "content": [{ "type": "text", "text": "Successfully wrote 195 bytes to ..." }]
    }
  }
}
```

---

## Content Block Types

Messages contain `content` arrays. Each block has a `type`:

| Type | Found In | Fields |
|---|---|---|
| `text` | user, assistant, toolResult | `text` |
| `thinking` | assistant | `thinking`, `thinkingSignature` |
| `toolCall` | assistant | `id`, `name`, `arguments` |

---

## Complete Flow Sequences

### 1. Connection (global)

```
server_hello
extension_ui_request (x N)
active_sessions
agent_state (x N, one per session)
```

### 2. Connection (session)

```
session_stream_hello
history_messages      ← event: history
history_done          ← event: history_done
```

### 3. Simple Text Response (no tools)

```
client_command {type: "prompt"}     ← global only
agent_start                         ← global only
session_state {isStreaming: true}    ← global only
turn_start
  message_start (user)
  message_end (user)
  message_start (assistant, empty)
    message_update: thinking_start
    message_update: thinking_delta (x N)
    message_update: thinking_end
    message_update: text_start
    message_update: text_delta (x N)
    message_update: text_end
  message_end (assistant, full content, stopReason: "stop")
turn_end                            ← global only
session_state {isStreaming: false}   ← global only
agent_end                           ← global only
```

### 4. Single Tool Call (thinking → tool → result → text)

```
turn_start
  message_start (user)
  message_end (user)
  message_start (assistant, empty)
    message_update: thinking_start
    message_update: thinking_delta (x N)
    message_update: thinking_end
    message_update: toolcall_start      ← contentIndex: 1
    message_update: toolcall_delta (x N)
    message_update: toolcall_end
  message_end (assistant, stopReason: "toolUse")
  tool_execution_start
  [tool_execution_update (x N)]         ← session stream only, for bash
  tool_execution_end
  message_start (toolResult)
  message_end (toolResult)
turn_end
turn_start                              ← auto-continues
  message_start (assistant, empty)
    message_update: text_start
    message_update: text_delta (x N)
    message_update: text_end
  message_end (assistant, stopReason: "stop")
turn_end
```

### 5. Parallel Tool Calls (3 writes at once)

```
message_start (assistant, empty)
  message_update: toolcall_start        ← contentIndex: 0
  message_update: toolcall_delta (x N)  ← contentIndex: 0
  message_update: toolcall_end          ← contentIndex: 0
  message_update: toolcall_start        ← contentIndex: 1
  message_update: toolcall_delta (x N)  ← contentIndex: 1
  message_update: toolcall_end          ← contentIndex: 1
  message_update: toolcall_start        ← contentIndex: 2
  message_update: toolcall_delta (x N)  ← contentIndex: 2
  message_update: toolcall_end          ← contentIndex: 2
message_end (assistant, 3 toolCalls in content)
tool_execution_start (toolCallId A)     ← all 3 fire together
tool_execution_start (toolCallId B)
tool_execution_start (toolCallId C)
tool_execution_end (toolCallId A)       ← finish in any order
message_start (toolResult A)
message_end (toolResult A)
tool_execution_end (toolCallId B)
message_start (toolResult B)
message_end (toolResult B)
tool_execution_end (toolCallId C)
message_start (toolResult C)
message_end (toolResult C)
```

### 6. Abort

```
client_command {type: "abort"}          ← global only
message_end (assistant, stopReason: "aborted", errorMessage: "Request was aborted.")
turn_end (stopReason: "aborted")
session_state {isStreaming: false}
agent_end (messages include the aborted assistant message)
```

### 7. Multi-Turn Tool Loop

Each tool call result triggers another `turn_start` automatically:

```
turn_start → user → assistant(toolUse) → tool_exec → toolResult → turn_end
turn_start → assistant(toolUse) → tool_exec → toolResult → turn_end
turn_start → assistant(toolUse) → tool_exec → toolResult → turn_end
turn_start → assistant(stop, text) → turn_end
```

---

## Message Roles

| Role | Description |
|---|---|
| `user` | User's prompt |
| `assistant` | LLM response (thinking + tool calls + text) |
| `toolResult` | Output from a tool execution |

---

## Key Implementation Notes

1. **`contentIndex` is critical** — thinking is always index 0, then tool calls / text follow sequentially. Multiple parallel tool calls get separate indices.

2. **`message_end` has the full message** — You can ignore deltas and reconstruct from `message_end` if you don't need streaming display.

3. **`toolcall_delta` streams raw JSON** — The deltas are JSON fragments. Only `toolcall_end` has the parsed `toolCall` object.

4. **`text_end` has the full text** — Same pattern as tool calls.

5. **`turn_end` vs `agent_end`** — A turn is one LLM call. An agent run is the full prompt-to-final-response cycle (multiple turns). `turn_end` fires after each LLM call; `agent_end` fires once at the very end.

6. **Session stream has `tool_execution_update`** — For long-running tools like `bash`, partial stdout is streamed. Global stream does not have this.

7. **History messages have `entryId`** — Each message in `history_messages` has an `entryId` for deduplication.

8. **`thinking_delta` comes word-by-word** — Each delta is typically a single word or punctuation token.

9. **`thinkingSignature`** — Present in `message_end` for thinking blocks. This is a base64 signature for verification.

10. **Empty `delta` on first `toolcall_delta`** — The first delta after `toolcall_start` is often an empty string `""`.
