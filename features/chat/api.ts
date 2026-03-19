import {
  createSession2,
  listSessions2,
  deleteSession as apiDeleteSession,
  touchSession2,
} from '@/features/api/generated/sdk.gen';
import { unwrapApiData, extractApiErrorMessage } from '@/features/api/unwrap';
import type {
  AgentSessionInfo,
  SessionListItem,
  PaginatedSessions,
} from '@/features/api/generated/types.gen';

export type { AgentSessionInfo, SessionListItem, PaginatedSessions };

export async function createChatSession(params?: {
  no_tools?: boolean;
  system_prompt?: string;
}): Promise<AgentSessionInfo> {
  const result = await createSession2({
    body: {
      no_tools: params?.no_tools,
      system_prompt: params?.system_prompt,
    },
  });
  if (result.error) {
    throw new Error(
      extractApiErrorMessage(result.error, extractApiErrorMessage(result.data, 'Failed to create chat session')),
    );
  }
  return unwrapApiData(result.data) as AgentSessionInfo;
}

export async function listChatSessions(
  page = 1,
  limit = 20,
): Promise<PaginatedSessions> {
  const result = await listSessions2({
    query: { page, limit },
  });
  if (result.error) {
    throw new Error(
      extractApiErrorMessage(result.error, extractApiErrorMessage(result.data, 'Failed to list chat sessions')),
    );
  }
  return unwrapApiData(result.data) as PaginatedSessions;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const result = await apiDeleteSession({
    path: { session_id: sessionId },
  });
  if (result.error) {
    throw new Error(
      extractApiErrorMessage(result.error, extractApiErrorMessage(result.data, 'Failed to delete chat session')),
    );
  }
}

export async function touchChatSession(
  sessionId: string,
): Promise<AgentSessionInfo> {
  const result = await touchSession2({
    path: { session_id: sessionId },
    body: {},
  });
  if (result.error) {
    throw new Error(
      extractApiErrorMessage(result.error, extractApiErrorMessage(result.data, 'Failed to touch chat session')),
    );
  }
  return unwrapApiData(result.data) as AgentSessionInfo;
}
