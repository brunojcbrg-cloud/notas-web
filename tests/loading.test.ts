import { describe, expect, it, vi } from 'vitest';
import { startElapsedLoading } from '../src/loading';

describe('tempo do carregamento', () => {
  it('fica quieto por dois segundos e depois atualiza a cada segundo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const values: number[] = [];
    const stop = startElapsedLoading((seconds) => values.push(seconds));

    vi.advanceTimersByTime(1_999);
    expect(values).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(values).toEqual([2]);
    vi.advanceTimersByTime(2_000);
    expect(values).toEqual([2, 3, 4]);

    stop();
    vi.advanceTimersByTime(2_000);
    expect(values).toEqual([2, 3, 4]);
    vi.useRealTimers();
  });
});
