import { useEffect, useRef } from "react";
import { landingRotation } from "../utils/random";
export function useWheelAnimation(
  index: number | undefined,
  count: number,
  spinKey: string | undefined,
  onFinish: () => void,
) {
  const ref = useRef<SVGSVGElement>(null);
  const rotation = useRef(0);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    if (index === undefined || !spinKey || !ref.current) return;
    const target = landingRotation(rotation.current, index, count);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const animation = ref.current.animate(
      [
        { transform: `rotate(${rotation.current}deg)` },
        { transform: `rotate(${target}deg)` },
      ],
      {
        duration: reduced ? 120 : 4800,
        easing: "cubic-bezier(.35,0,.12,1)",
        fill: "forwards",
      },
    );
    animation.onfinish = () => {
      rotation.current = target;
      if (ref.current) ref.current.style.transform = `rotate(${target}deg)`;
      animation.cancel();
      finish.current();
    };
    return () => animation.cancel();
  }, [index, count, spinKey]);
  return ref;
}
