import { describe, expect, it } from 'vitest';
import type { RunningSession } from '../../src/agent/types';
import { matchClaudeSessions, normalizeCwd } from '../../src/claude/match';

const s = (over: Partial<RunningSession>): RunningSession => ({
  sessionId: '11111111-1111-4111-8111-111111111111', name: 'a', cwd: 'D:\\x',
  pid: 1, kind: 'interactive', status: 'idle', ...over,
});
const SID2 = '22222222-2222-4222-8222-222222222222';
const SID3 = '33333333-3333-4333-8333-333333333333';

describe('normalizeCwd', () => {
  it('win32: không phân biệt hoa thường và dấu chéo', () => {
    expect(normalizeCwd('D:\\Coding\\ERP', 'win32')).toBe(normalizeCwd('d:/coding/erp', 'win32'));
  });
  it('linux: giữ nguyên hoa thường', () => {
    expect(normalizeCwd('/a/B', 'linux')).not.toBe(normalizeCwd('/a/b', 'linux'));
  });
});

describe('matchClaudeSessions', () => {
  it('1 terminal + 1 session cùng cwd → matched', () => {
    const r = matchClaudeSessions([{ terminalId: 't1', cwd: 'd:/x' }], [s({})], 'win32');
    expect(r.matched).toEqual([{ terminalId: 't1', session: s({}) }]);
    expect(r.ambiguous).toEqual([]);
  });

  it('bỏ qua hàng background và hàng cwd rỗng', () => {
    const r = matchClaudeSessions(
      [{ terminalId: 't1', cwd: 'D:\\x' }],
      [s({ kind: 'background' }), s({ sessionId: SID2, cwd: '' })],
      'win32',
    );
    expect(r.matched).toEqual([]);
  });

  it('session đã bị terminal khác giữ thì không match lại; candidate đã giữ cũng đứng ngoài', () => {
    const r = matchClaudeSessions(
      [
        { terminalId: 't1', cwd: 'D:\\x', claimedSessionId: s({}).sessionId },
        { terminalId: 't2', cwd: 'D:\\x' },
      ],
      [s({}), s({ sessionId: SID2 })],
      'win32',
    );
    // t1 giữ session 1 → còn t2 và session 2: 1-1 → matched
    expect(r.matched).toEqual([{ terminalId: 't2', session: s({ sessionId: SID2 }) }]);
  });

  it('2 terminal + 1 session cùng cwd → ambiguous, không đoán', () => {
    const r = matchClaudeSessions(
      [{ terminalId: 't1', cwd: 'D:\\x' }, { terminalId: 't2', cwd: 'D:\\x' }],
      [s({})], 'win32',
    );
    expect(r.matched).toEqual([]);
    expect(r.ambiguous).toEqual([
      { cwd: normalizeCwd('D:\\x', 'win32'), terminalIds: ['t1', 't2'], sessions: [s({})] },
    ]);
  });

  it('1 terminal + 2 session cùng cwd → ambiguous', () => {
    const r = matchClaudeSessions(
      [{ terminalId: 't1', cwd: 'D:\\x' }],
      [s({}), s({ sessionId: SID3 })], 'win32',
    );
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0]!.sessions).toHaveLength(2);
  });

  it('session không cùng cwd với terminal nào → bị bỏ, không matched không ambiguous', () => {
    const r = matchClaudeSessions([{ terminalId: 't1', cwd: 'D:\\y' }], [s({})], 'win32');
    expect(r).toEqual({ matched: [], ambiguous: [] });
  });
});
