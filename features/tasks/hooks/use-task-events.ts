import { useEffect, useRef } from 'react';
import { useTasksStore } from '../store';

/**
 * Hook to listen for task-related stream events from the agent event bus.
 * This integrates with the existing agent SSE/WS stream.
 */
export function useTaskStreamEvents() {
  const appendLogLine = useTasksStore((s) => s.appendLogLine);
  const updateTaskStatus = useTasksStore((s) => s.updateTaskStatus);
  const addTaskInstance = useTasksStore((s) => s.addTaskInstance);
  const stableRef = useRef({ appendLogLine, updateTaskStatus, addTaskInstance });

  useEffect(() => {
    stableRef.current = { appendLogLine, updateTaskStatus, addTaskInstance };
  });

  return stableRef;
}

/**
 * Process a raw stream event and dispatch to the tasks store if relevant.
 */
export function handleTaskStreamEvent(
  eventType: string,
  data: any,
  storeActions: {
    appendLogLine: (taskId: string, line: string) => void;
    updateTaskStatus: (taskId: string, status: 'running' | 'stopped' | 'failed', exitCode?: number | null) => void;
    addTaskInstance: (info: any) => void;
  },
) {
  switch (eventType) {
    case 'task_output': {
      const { task_id, line } = data;
      if (task_id && typeof line === 'string') {
        storeActions.appendLogLine(task_id, line);
      }
      break;
    }
    case 'task_started': {
      const { task_id, label, command, source } = data;
      if (task_id) {
        storeActions.addTaskInstance({
          id: task_id,
          label: label || '',
          command: command || '',
          workspace_id: data.workspace_id || '',
          status: 'running' as const,
          exit_code: null,
          started_at: new Date().toISOString(),
          stopped_at: null,
          source: source || 'pi',
        });
      }
      break;
    }
    case 'task_stopped': {
      const { task_id, status, exit_code } = data;
      if (task_id) {
        storeActions.updateTaskStatus(task_id, status || 'stopped', exit_code);
      }
      break;
    }
  }
}
