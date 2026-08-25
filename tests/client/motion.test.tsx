// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitWithMotion, MotionValue, motionStyle } from '../../src/client/motion.js';

afterEach(() => {
  delete (document as Document & { startViewTransition?: unknown }).startViewTransition;
  vi.unstubAllGlobals();
});

describe('motion helpers', () => {
  it('uses native view transitions and clamps stagger delays', () => {
    const catchSkippedTransition = vi.fn();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { ready: { catch: catchSkippedTransition } };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const update = vi.fn();

    commitWithMotion(update);

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(catchSkippedTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(motionStyle(12, 'subject-1')).toEqual({ '--motion-index': 5, viewTransitionName: 'subject-1' });
  });

  it('cross-fades a changed value and skips view transitions for reduced motion', () => {
    const startViewTransition = vi.fn((update: () => void) => update());
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const update = vi.fn();
    const { rerender } = render(<MotionValue value={1}>1 集</MotionValue>);

    rerender(<MotionValue value={2}>2 集</MotionValue>);
    commitWithMotion(update);

    expect(screen.getByText('2 集')).toHaveClass('motion-value');
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });
});
