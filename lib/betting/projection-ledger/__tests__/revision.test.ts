import { describe, expect, it } from 'vitest';
import { isProductionGitSha, resolvePackagedGitSha, revisionsAgree } from '@/lib/betting/projection-ledger/revision';

const head = '0123456789abcdef0123456789abcdef01234567';

describe('projection ledger git revision', () => {
  it('stamps a clean HEAD and rejects a dirty tree', () => {
    expect(resolvePackagedGitSha({ head, dirty: false })).toEqual({ gitSha: head, source: 'git-head' });
    expect(resolvePackagedGitSha({ head, dirty: true })).toEqual({ gitSha: '', source: 'dirty-worktree' });
    expect(resolvePackagedGitSha({ head: 'HEAD', dirty: false }).source).toBe('unresolved-head');
    expect(isProductionGitSha('')).toBe(false);
    expect(isProductionGitSha('test:certification')).toBe(false);
  });

  it('requires the packaged SHA and the environment SHA to be the same commit', () => {
    expect(revisionsAgree(head, head)).toBe(true);
    expect(revisionsAgree(head, `${head} `)).toBe(true);
    expect(revisionsAgree(head, 'f'.repeat(40))).toBe(false);
    expect(revisionsAgree('', head)).toBe(false);
    expect(revisionsAgree(head, '')).toBe(false);
    expect(revisionsAgree('test:certification', 'test:certification')).toBe(false);
  });
});
