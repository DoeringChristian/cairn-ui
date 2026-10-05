/**
 * Custom viewers: snapshots for frames the WebGL budget keeps paused
 * (pure; tested in capture-queue.test.ts).
 *
 * A paused frame shows its last snapshot. One that never ran (a gallery
 * bigger than the budget) or whose snapshot is stale (the step or settings
 * changed while it was paused) gets one here: frames take turns to run
 * briefly — load, render, snapshot, tear down — `concurrency` at a time, so
 * the extra WebGL contexts stay bounded (the page's limit is 16; the budget
 * uses 10). Higher priority (on screen) runs first, then request order.
 */

export type CaptureStart = (done: () => void) => void;

interface Job {
  id: string;
  start: CaptureStart;
  priority: number;
  order: number;
}

export class CaptureQueue {
  private readonly waiting = new Map<string, Job>();
  private readonly running = new Map<string, () => void>();
  private order = 0;
  private readonly concurrency: number;

  constructor(concurrency = 1) {
    this.concurrency = concurrency;
  }

  /**
   * Ask for a turn; `start(done)` is called when it comes, and the frame
   * calls `done` when its snapshot is taken (or it gave up). A newer request
   * of the same id replaces a waiting one. Returns the cancel function
   * (also ends a running turn).
   */
  request(id: string, start: CaptureStart, priority = 0): () => void {
    this.waiting.set(id, { id, start, priority, order: this.order++ });
    this.pump();
    return () => this.cancel(id);
  }

  cancel(id: string): void {
    this.waiting.delete(id);
    if (this.running.delete(id)) this.pump();
  }

  /** Frames waiting and running (for tests and the debug hook). */
  stats(): { waiting: number; running: number } {
    return { waiting: this.waiting.size, running: this.running.size };
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.waiting.size > 0) {
      let next: Job | null = null;
      for (const j of this.waiting.values()) {
        if (!next || j.priority > next.priority || (j.priority === next.priority && j.order < next.order)) next = j;
      }
      const job = next!;
      this.waiting.delete(job.id);
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (this.running.get(job.id) === done) {
          this.running.delete(job.id);
          this.pump();
        }
      };
      this.running.set(job.id, done);
      job.start(done);
    }
  }
}
