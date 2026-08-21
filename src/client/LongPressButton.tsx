import { useEffect, useRef, useState } from 'react';

const HOLD_DURATION_MS = 1_500;

export default function LongPressButton({ subjectTitle, disabled, onCommit }: {
  subjectTitle: string;
  disabled?: boolean;
  onCommit(): void;
}) {
  const [pressing, setPressing] = useState(false);
  const timerRef = useRef<number | null>(null);

  function cancel() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPressing(false);
  }

  function start() {
    if (disabled || timerRef.current !== null) return;
    setPressing(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setPressing(false);
      onCommit();
    }, HOLD_DURATION_MS);
  }

  useEffect(() => {
    if (!pressing) return;
    window.addEventListener('scroll', cancel, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', cancel, { capture: true });
  }, [pressing]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return (
    <button
      type="button"
      className={`secondary long-press-button${pressing ? ' is-pressing' : ''}`}
      disabled={disabled}
      aria-label={`长按 1.5 秒抛弃 ${subjectTitle}`}
      title="长按 1.5 秒抛弃"
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerMove={(event) => {
        if (!pressing) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          cancel();
        }
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onLostPointerCapture={cancel}
      onBlur={cancel}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      长按抛弃
    </button>
  );
}
