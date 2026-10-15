import { useEffect, useState } from "react";
import { createJobs, listTasks, type Task } from "@pvx/core";

const POLL_MS = 1000;
/** Lines of a task's log the tab keeps: what fits the screen is shown, the rest scrolls. */
const LOG_TAIL = 200;

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every task of the central, read again every second while `enabled`; `now` ticks with it so the times of the running ones advance. */
export function useTasks(enabled: boolean): { tasks: Task[]; now: number } {
  const [tasks, setTasks] = useState<Task[]>(() => (enabled ? listTasks() : []));
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      const next = listTasks();
      setTasks((current) => (sameJson(current, next) ? current : next));
      setNow(Date.now());
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return { tasks, now };
}

/** The tail of one task's log, read again every second while the task runs (once for a finished one). */
export function useTaskLog(task: Task | undefined): string[] {
  const [lines, setLines] = useState<string[]>([]);
  const module = task?.module;
  const name = task?.name;
  const running = task?.status.state === "running";
  useEffect(() => {
    if (!module || !name) return void setLines([]);
    let live = true;
    const read = async () => {
      const next = await createJobs(module).log(name, { tail: LOG_TAIL });
      if (live) setLines((current) => (sameJson(current, next) ? current : next));
    };
    void read();
    const timer = running ? setInterval(() => void read(), POLL_MS) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [module, name, running]);
  return lines;
}
