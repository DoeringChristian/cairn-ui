/**
 * "Is this element on screen, or about to be?" for lazily mounted cards.
 *
 * One shared IntersectionObserver whose root margin reaches one viewport
 * above and below the screen. An element that enters the screen itself is
 * reported at once; one that is only within the margin is reported a little
 * later, a few per idle slice, so prefetching the next screen never competes
 * with painting this one. Reports are one-shot: a card, once mounted, stays.
 */

type Listener = () => void;

const MARGIN = "100% 0px 100% 0px";
/** Near-only elements reported per idle slice. */
const NEAR_PER_SLICE = 4;

let observer: IntersectionObserver | null = null;
const listeners = new Map<Element, Listener>();
const nearQueue = new Set<Element>();
let nearScheduled = false;

const idle: (fn: () => void) => void =
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? (fn) => window.requestIdleCallback(fn, { timeout: 500 })
    : (fn) => setTimeout(fn, 50);

function fire(el: Element): void {
  const fn = listeners.get(el);
  if (!fn) return;
  listeners.delete(el);
  nearQueue.delete(el);
  observer?.unobserve(el);
  fn();
}

function drainNear(): void {
  nearScheduled = false;
  let n = 0;
  for (const el of nearQueue) {
    if (n++ >= NEAR_PER_SLICE) break;
    fire(el);
  }
  if (nearQueue.size > 0) scheduleNear();
}

function scheduleNear(): void {
  if (nearScheduled) return;
  nearScheduled = true;
  idle(drainNear);
}

function getObserver(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      const vh = window.innerHeight;
      for (const e of entries) {
        if (!e.isIntersecting) {
          nearQueue.delete(e.target);
          continue;
        }
        const r = e.boundingClientRect;
        if (r.bottom > 0 && r.top < vh) fire(e.target);
        else nearQueue.add(e.target);
      }
      if (nearQueue.size > 0) scheduleNear();
    },
    { rootMargin: MARGIN },
  );
  return observer;
}

/** Call `fn` once, when `el` is on or near the screen. Returns a cancel function. */
export function whenNearViewport(el: Element, fn: Listener): () => void {
  if (typeof IntersectionObserver === "undefined") {
    fn();
    return () => {};
  }
  listeners.set(el, fn);
  getObserver().observe(el);
  return () => {
    if (listeners.get(el) !== fn) return;
    listeners.delete(el);
    nearQueue.delete(el);
    observer?.unobserve(el);
  };
}
