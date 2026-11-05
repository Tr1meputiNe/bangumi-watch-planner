import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error launcher is intentionally dependency-free packaged JavaScript
import { inspectService, matchesTrackedCommand } from '../../packaging/macos/launcher.mjs';

describe('portable launcher service identity', () => {
  it('opens only a verified planner service', async () => {
    const request = vi.fn(async () => new Response('{}', { headers: { 'x-bwp-app': 'bangumi-watch-planner' } }));
    expect(await inspectService('http://127.0.0.1:3777', request)).toBe('ours');
    expect(request).toHaveBeenCalledWith('http://127.0.0.1:3777/api/auth/status', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('distinguishes unrelated port occupants from an absent server', async () => {
    expect(await inspectService('http://127.0.0.1:3777', async () => new Response('{}'))).toBe('other');
    expect(await inspectService('http://127.0.0.1:3777', async () => { throw new Error('refused'); })).toBe('absent');
  });
  it('never terminates a reused PID or a different command', () => {
    const record = { pid: 123, node: '/Applications/Planner App/node', server: '/Applications/Planner App/index.js' };
    expect(matchesTrackedCommand(record, '/Applications/Planner App/node /Applications/Planner App/index.js\n')).toBe(true);
    expect(matchesTrackedCommand(record, '/Applications/Other App/node /Applications/Other App/index.js')).toBe(false);
    expect(matchesTrackedCommand({ ...record, pid: 1 }, `${record.node} ${record.server}`)).toBe(false);
    expect(matchesTrackedCommand(null, '')).toBe(false);
  });
});
