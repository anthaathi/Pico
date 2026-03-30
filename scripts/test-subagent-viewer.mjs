import assert from 'node:assert/strict';
import { createEmptySessionState, reduceStreamEvent, convertRawMessages } from '../packages/pi-client/src/core/message-reducer.ts';

function envelope(id, type, data, timestamp = id) {
  return {
    id,
    type,
    session_id: 's1',
    timestamp,
    data,
  };
}

function apply(events) {
  let state = createEmptySessionState();
  for (const event of events) {
    state = reduceStreamEvent(state, event);
  }
  return state;
}

function testHistorySubagentResult() {
  const rawMessages = [
    {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'sub-1',
          name: 'subagent',
          arguments: {
            agent: 'explore',
            task: 'Investigate rendering',
          },
        },
      ],
      timestamp: 1,
      stopReason: 'toolUse',
    },
    {
      role: 'toolResult',
      toolCallId: 'sub-1',
      toolName: 'subagent',
      isError: false,
      content: [{ type: 'text', text: '# Findings\n\n- A\n- B' }],
      timestamp: 2,
    },
  ];

  const converted = convertRawMessages(rawMessages);
  assert.equal(converted.length, 1);
  assert.equal(converted[0].role, 'assistant');
  assert.equal(converted[0].toolCalls?.[0]?.name, 'subagent');
  assert.equal(converted[0].toolCalls?.[0]?.result, '# Findings\n\n- A\n- B');
}

function testStreamingPartialResult() {
  const state = apply([
    envelope(1, 'message_start', {
      type: 'message_start',
      message: { role: 'assistant', content: [], timestamp: 1 },
    }),
    envelope(2, 'message_update', {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: { id: 'temp-sub', name: 'subagent' },
      },
    }),
    envelope(3, 'tool_execution_update', {
      type: 'tool_execution_update',
      toolCallId: 'temp-sub',
      toolName: 'subagent',
      partialResult: {
        content: [{ type: 'text', text: '# Streaming\n\nworking...' }],
      },
    }),
  ]);

  assert.equal(state.messages[0]?.toolCalls?.[0]?.partialResult, '# Streaming\n\nworking...');
}

function testParallelToolcallContentIndexRouting() {
  const state = apply([
    envelope(1, 'message_start', {
      type: 'message_start',
      message: { role: 'assistant', content: [], timestamp: 1 },
    }),
    envelope(2, 'message_update', {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: { id: 'a', name: 'write' },
      },
    }),
    envelope(3, 'message_update', {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 1,
        partial: { id: 'b', name: 'subagent' },
      },
    }),
    envelope(4, 'message_update', {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_delta',
        contentIndex: 0,
        delta: '{"path":"a.txt"}',
      },
    }),
    envelope(5, 'message_update', {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_delta',
        contentIndex: 1,
        delta: '{"agent":"explore","task":"scan"}',
      },
    }),
  ]);

  assert.equal(state.messages[0]?.toolCalls?.[0]?.arguments, '{"path":"a.txt"}');
  assert.equal(state.messages[0]?.toolCalls?.[1]?.arguments, '{"agent":"explore","task":"scan"}');
}

function testMessageEndRebuildsToolCallsFromFullContent() {
  const state = apply([
    envelope(1, 'message_start', {
      type: 'message_start',
      message: { role: 'assistant', content: [], timestamp: 1 },
    }),
    envelope(2, 'message_update', {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: { id: 'temp-1', name: 'subagent' },
      },
    }),
    envelope(3, 'message_update', {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_delta',
        contentIndex: 0,
        delta: '{"agent":"explore"',
      },
    }),
    envelope(4, 'message_end', {
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'toolUse',
        timestamp: 4,
        content: [
          { type: 'thinking', thinking: 'x' },
          {
            type: 'toolCall',
            id: 'final-1',
            name: 'subagent',
            arguments: { agent: 'explore', task: 'Investigate' },
          },
          {
            type: 'toolCall',
            id: 'final-2',
            name: 'read',
            arguments: { path: 'docs/MESSAGE_PATTERNS.md' },
          },
        ],
      },
    }),
  ]);

  assert.equal(state.messages[0]?.toolCalls?.length, 2);
  assert.equal(state.messages[0]?.toolCalls?.[0]?.id, 'final-1');
  assert.equal(state.messages[0]?.toolCalls?.[0]?.arguments, '{"agent":"explore","task":"Investigate"}');
  assert.equal(state.messages[0]?.toolCalls?.[1]?.id, 'final-2');
}

function run() {
  testHistorySubagentResult();
  testStreamingPartialResult();
  testParallelToolcallContentIndexRouting();
  testMessageEndRebuildsToolCallsFromFullContent();
  console.log('subagent viewer reducer tests passed');
}

run();
