/** A single task definition – either from .pi/tasks.json or auto-detected */
export interface TaskDefinition {
  label: string;
  type: string;
  command: string;
  group?: string;
  is_background?: boolean;
  auto_run?: boolean;
  cwd?: string;
  env?: Record<string, string>;
  /** Where this task was detected from: "npm", "yarn", "pnpm", "bun", "make",
   *  "cargo", "docker", "python", "rake", "gradle", "deno", "pi" */
  source: string;
}

/** Tasks configuration file read from workspace */
export interface TasksConfig {
  version: string;
  tasks: TaskDefinition[];
}

/** Runtime status of a task */
export type TaskStatus = 'running' | 'stopped' | 'failed';

/** A running/stopped task instance */
export interface TaskInfo {
  id: string;
  label: string;
  command: string;
  workspace_id: string;
  status: TaskStatus;
  exit_code: number | null;
  started_at: string;
  stopped_at: string | null;
  /** Source of the task */
  source: string;
}

/** Task log output */
export interface TaskLogs {
  id: string;
  label: string;
  lines: string[];
  total_lines: number;
}

/** Known task sources for rendering icons/badges */
export type TaskSource =
  | 'npm'
  | 'yarn'
  | 'pnpm'
  | 'bun'
  | 'make'
  | 'cargo'
  | 'docker'
  | 'python'
  | 'rake'
  | 'gradle'
  | 'deno'
  | 'pi';
