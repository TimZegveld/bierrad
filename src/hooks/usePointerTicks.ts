import { useEffect, useRef, type RefObject } from "react";
import { pegsPassed, unwrapRotation } from "../domain/spin";
/**
 * How far a peg flicks the pointer tip, and how long it takes to fall back. The wheel
 * turns clockwise, so pegs push the tip to the right: a negative rotation from the top.
 */
const TICK_DEGREES = -10;
const SETTLE_MS = 90;
function wheelAngle(element: Element): number {
  const matrix = new DOMMatrix(getComputedStyle(element).transform);
  return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
}
/**
 * Playback only: follows the wheel's on-screen rotation and flicks the pointer for every
 * rim peg that passes, so the ticking slows down with the wheel.
 */
export function usePointerTicks(
  wheel: RefObject<SVGSVGElement | null>,
  active: boolean,
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pointer = ref.current;
    const element = wheel.current;
    if (!active || !pointer || !element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let rotation = wheelAngle(element);
    let tickedAt = -Infinity;
    let frame = requestAnimationFrame(function step(now) {
      const next = unwrapRotation(rotation, wheelAngle(element));
      if (pegsPassed(rotation, next)) tickedAt = now;
      rotation = next;
      const settle = Math.max(0, 1 - (now - tickedAt) / SETTLE_MS);
      pointer.style.transform = settle
        ? `rotate(${TICK_DEGREES * settle}deg)`
        : "";
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      pointer.style.transform = "";
    };
  }, [wheel, active]);
  return ref;
}
