import { useEffect, useRef, useContext } from "react";
import type { SpinInstruction } from "../domain/models";
import { getSpinTiming } from "../domain/spin";
import { PlaybackClock } from "./PlaybackClock";
/** Playback only: finishing or skipping an animation never changes session state. */
export function useWheelAnimation(spin?: SpinInstruction) {
  const offset = useContext(PlaybackClock);
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!spin) {
      element.style.transform = "rotate(0deg)";
      return;
    }
    const timing = getSpinTiming(spin, Date.now() + offset);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (timing.finished) {
      element.style.transform = `rotate(${spin.targetRotation}deg)`;
      return;
    }
    if (reduced) {
      element.style.transform = `rotate(${spin.startRotation}deg)`;
      const timer = window.setTimeout(
        () => {
          element.style.transform = `rotate(${spin.targetRotation}deg)`;
        },
        timing.delayMs + spin.durationMs - timing.elapsedMs,
      );
      return () => window.clearTimeout(timer);
    }
    element.style.transform = `rotate(${spin.targetRotation}deg)`;
    const animation = element.animate(
      [
        { transform: `rotate(${spin.startRotation}deg)` },
        { transform: `rotate(${spin.targetRotation}deg)` },
      ],
      {
        duration: spin.durationMs,
        delay: timing.delayMs,
        easing: spin.easing,
        fill: "both",
      },
    );
    // Seek along the original easing curve rather than restarting a shortened animation.
    animation.currentTime = timing.elapsedMs;
    return () => animation.cancel();
  }, [spin, offset]);
  return ref;
}
