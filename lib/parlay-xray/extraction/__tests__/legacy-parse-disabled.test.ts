import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: vi.fn(async () => {
    throw new Error('legacy parse must not reach auth when disabled');
  }),
}));

vi.mock('@/lib/betting/bet-slip/openai-extract', () => ({
  fetchBetSlipExtractionFromOpenAi: vi.fn(async () => {
    throw new Error('legacy parse must not call OpenAI when disabled');
  }),
}));

import { POST } from '@/app/api/betting/bet-slip/parse/route';
import { fetchBetSlipExtractionFromOpenAi } from '@/lib/betting/bet-slip/openai-extract';

describe('legacy bet-slip parse isolation', () => {
  it('is disabled by default and does not call OpenAI', async () => {
    vi.stubEnv('BET_SLIP_PARSE_ENABLED', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'slip.png');
    const res = await POST(
      new NextRequest('http://localhost/api/betting/bet-slip/parse', { method: 'POST', body: form })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('PARSE_DISABLED');
    expect(fetchBetSlipExtractionFromOpenAi).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
