import { useEffect, useRef, useState } from 'react';

/** Tweens from the previous value to the new one whenever `value` changes. */
export default function AnimatedNumber({ value, decimals = 0, suffix = '', duration = 700 }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value || typeof value !== 'number') {
      setDisplay(value);
      return undefined;
    }
    const start = performance.now();
    let frame;
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) frame = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      fromRef.current = value;
    };
  }, [value, duration]);

  if (typeof display !== 'number') return <>{display}</>;
  return (
    <>
      {display.toFixed(decimals)}
      {suffix}
    </>
  );
}
