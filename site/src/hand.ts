import type { Session } from './session';
import type { Showcase } from './showcase';

/**
 * A visitor's hand on the live component. A drag that starts anywhere on it, or on the grab bar
 * that rides its moving edge, takes hold of the motion. The edge then stays under the pointer,
 * and letting go hands the position and the speed to the spring. A press that never moves is
 * still a press, so every button in the component keeps working.
 */
const BODY_SLOP_PX = 6;
const BAR_SLOP_PX = 2;
/** Pointer events closer together than this are dropped, so a link can hold a long gesture. */
const SAMPLE_GAP_MS = 7;
/** How far past either end the hand can pull, and how hard that resists. */
const STRETCH_PX = 44;
/** A key press moves the edge this far, and the hand lets go this long after the last key. */
const KEY_STEP_PX = 14;
const KEY_REST_MS = 260;

const FIELDS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export interface HandOptions {
  session: Session;
  showcase: Showcase;
  /** The live component. */
  live: HTMLElement;
  /** The grab bar. */
  bar: HTMLElement;
  /** Called when a hand takes hold or lets go, for the page to show it. */
  onHold(held: boolean): void;
}

export function attachHand({ session, showcase, live, bar, onHold }: HandOptions) {
  let pointer: { id: number; x: number; y: number; edge: number; held: boolean; fromBar: boolean; lastMs: number } | null = null;
  let keyTimer = 0;
  let keyEdge: number | null = null;

  /** The ends resist: the further past one the pointer goes, the less the edge follows. */
  function resist(edge: number) {
    const { levels } = session.get()!;
    const lo = Math.min(levels.low, levels.high);
    const hi = Math.min(Math.max(levels.low, levels.high), levels.clip);
    const give = (over: number) => STRETCH_PX * (1 - 1 / (1 + over / STRETCH_PX));
    if (edge < lo) return lo - give(lo - edge);
    // A target that slides out of its component cannot be pulled further than out.
    if (edge > hi) return showcase.track.edge === 'top' ? hi : hi + give(edge - hi);
    return edge;
  }

  function swallowClick() {
    const stop = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    live.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => live.removeEventListener('click', stop, { capture: true }), 0);
  }

  function letGo() {
    if (!pointer) return;
    const { held, fromBar, id } = pointer;
    pointer = null;
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    if (fromBar && bar.hasPointerCapture(id)) bar.releasePointerCapture(id);
    if (!held) return;
    session.release();
    onHold(false);
  }

  function move(event: PointerEvent) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.held) {
      const far = pointer.fromBar ? Math.abs(dy) >= BAR_SLOP_PX : Math.abs(dy) >= BODY_SLOP_PX && Math.abs(dy) > Math.abs(dx);
      if (!far) return;
      const edge = session.edge();
      if (!session.grab()) {
        letGo();
        return;
      }
      // The edge is taken from where it is now, so nothing jumps when the hand lands.
      pointer = { ...pointer, held: true, y: event.clientY, edge };
      getSelection()?.removeAllRanges();
      onHold(true);
      return;
    }
    if (event.timeStamp - pointer.lastMs < SAMPLE_GAP_MS) return;
    pointer.lastMs = event.timeStamp;
    session.drag(resist(pointer.edge + dy));
  }

  function up(event: PointerEvent) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const { held, fromBar } = pointer;
    if (held) {
      // The place the hand let go, even when the last move was dropped for coming too soon.
      session.drag(resist(pointer.edge + event.clientY - pointer.y));
      if (!fromBar) swallowClick();
    }
    letGo();
    if (!held && fromBar && event.type === 'pointerup') toggle();
  }

  function down(event: PointerEvent, fromBar: boolean) {
    if (pointer || event.button !== 0 || session.holding()) return;
    if (!fromBar) {
      // On a touch screen a drag on the component scrolls the page. The bar is the handle there.
      if (event.pointerType === 'touch') return;
      if ((event.target as Element).closest(FIELDS)) return;
    } else {
      event.preventDefault();
      bar.focus({ preventScroll: true });
      bar.setPointerCapture(event.pointerId);
    }
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, edge: 0, held: false, fromBar, lastMs: 0 };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  /** A press on the bar that never moves does what the component's own button would. */
  function toggle() {
    const snap = session.get();
    if (!snap) return;
    if (snap.state === showcase.from) session.send(showcase.go);
    else if (snap.state === showcase.to) session.send(showcase.back);
  }

  function key(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
      return;
    }
    const step = { ArrowDown: KEY_STEP_PX, ArrowUp: -KEY_STEP_PX }[event.key];
    if (step === undefined || pointer) return;
    event.preventDefault();
    if (keyEdge === null) {
      const edge = session.edge();
      if (!session.grab()) return;
      keyEdge = edge;
      onHold(true);
    }
    keyEdge = resist(keyEdge + (event.shiftKey ? step / 4 : step));
    session.drag(keyEdge);
    clearTimeout(keyTimer);
    keyTimer = window.setTimeout(() => {
      keyEdge = null;
      session.release();
      onHold(false);
    }, KEY_REST_MS);
  }

  const bodyDown = (event: PointerEvent) => down(event, false);
  const barDown = (event: PointerEvent) => down(event, true);
  live.addEventListener('pointerdown', bodyDown);
  bar.addEventListener('pointerdown', barDown);
  bar.addEventListener('keydown', key);
  return () => {
    clearTimeout(keyTimer);
    if (keyEdge !== null) session.release();
    letGo();
    live.removeEventListener('pointerdown', bodyDown);
    bar.removeEventListener('pointerdown', barDown);
    bar.removeEventListener('keydown', key);
  };
}
