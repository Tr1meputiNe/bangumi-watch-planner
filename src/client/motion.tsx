import type { CSSProperties, ReactNode } from 'react';
import { flushSync } from 'react-dom';

type MotionStyle = CSSProperties & {
  '--motion-index': number;
  viewTransitionName: string;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

export function motionStyle(index: number, name: string): MotionStyle {
  return {
    '--motion-index': Math.min(Math.max(index, 0), 5),
    viewTransitionName: name
  };
}

export function commitWithMotion(update: () => void): void {
  const documentWithTransition = document as ViewTransitionDocument;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!documentWithTransition.startViewTransition || reducedMotion) {
    update();
    return;
  }

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    flushSync(update);
  };
  try {
    documentWithTransition.startViewTransition(commit);
  } catch {
    commit();
  }
}

export function MotionValue({ value, children, className = '' }: { value: string | number; children?: ReactNode; className?: string }) {
  return (
    <span className="motion-value-clip">
      <span key={String(value)} className={`motion-value${className ? ` ${className}` : ''}`}>{children ?? value}</span>
    </span>
  );
}
