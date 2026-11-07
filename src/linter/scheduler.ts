/** One timer and cancellation controller per URI; stale completion never publishes. */
export class Scheduler {
  private jobs = new Map<
    string,
    { controller: AbortController; timer?: ReturnType<typeof setTimeout> }
  >();
  schedule(
    key: string,
    delay: number,
    task: (signal: AbortSignal) => Promise<void>,
  ) {
    this.cancel(key);
    const controller = new AbortController();
    const job = {
      controller,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    this.jobs.set(key, job);
    job.timer = setTimeout(async () => {
      try {
        if (!controller.signal.aborted) await task(controller.signal);
      } finally {
        if (this.jobs.get(key) === job) this.jobs.delete(key);
      }
    }, delay);
  }
  cancel(key: string) {
    const job = this.jobs.get(key);
    if (job) {
      clearTimeout(job.timer);
      job.controller.abort();
      this.jobs.delete(key);
    }
  }
  dispose() {
    for (const key of this.jobs.keys()) this.cancel(key);
  }
}
