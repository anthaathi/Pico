import { useEffect } from 'react';
import { usePiClient } from '@pi-ui/client';
import { useTasksStore } from '../store';
import { handleTaskStreamEvent } from '../hooks/use-task-events';

/**
 * Invisible component that subscribes to the PiClient event stream
 * and dispatches task-related events to the tasks store.
 */
export function TaskEventSubscriber() {
  const client = usePiClient();
  const appendLogLine = useTasksStore((s) => s.appendLogLine);
  const updateTaskStatus = useTasksStore((s) => s.updateTaskStatus);
  const addTaskInstance = useTasksStore((s) => s.addTaskInstance);

  useEffect(() => {
    const sub = client.events$.subscribe((envelope) => {
      const eventType = envelope.type;
      const data = envelope.data;

      if (
        eventType === 'task_output' ||
        eventType === 'task_started' ||
        eventType === 'task_stopped'
      ) {
        handleTaskStreamEvent(eventType, data, {
          appendLogLine,
          updateTaskStatus,
          addTaskInstance,
        });
      }
    });
    return () => sub.unsubscribe();
  }, [client, appendLogLine, updateTaskStatus, addTaskInstance]);

  return null;
}
