export interface LoadingScheduler {
  now(): number;
  timeout(action: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  interval(action: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

const browserScheduler: LoadingScheduler = {
  now: () => Date.now(),
  timeout: (action, delayMs) => globalThis.setTimeout(action, delayMs),
  interval: (action, delayMs) => globalThis.setInterval(action, delayMs),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  clearInterval: (id) => globalThis.clearInterval(id),
};

export function startElapsedLoading(
  update: (seconds: number) => void,
  scheduler: LoadingScheduler = browserScheduler,
): () => void {
  const startedAt = scheduler.now();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const tick = (): void => update(Math.max(0, Math.floor((scheduler.now() - startedAt) / 1000)));
  const timeoutId = scheduler.timeout(() => {
    tick();
    intervalId = scheduler.interval(tick, 1_000);
  }, 2_000);
  return () => {
    scheduler.clearTimeout(timeoutId);
    if (intervalId !== null) scheduler.clearInterval(intervalId);
  };
}
