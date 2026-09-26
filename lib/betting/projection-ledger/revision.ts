/**
 * Production code revision is the git commit that was packaged.
 * A short label, a placeholder, or a dirty-tree stamp cannot authorize
 * a PROSPECTIVE_LIVE row.
 */

const PRODUCTION_GIT_SHA = /^[0-9a-f]{40}$/;

export function isProductionGitSha(value: string | null | undefined): boolean {
  return PRODUCTION_GIT_SHA.test((value ?? '').trim());
}

export function resolvePackagedGitSha(args: {
  head: string | null | undefined;
  dirty: boolean;
}): { gitSha: string; source: 'git-head' | 'dirty-worktree' | 'unresolved-head' } {
  if (args.dirty) return { gitSha: '', source: 'dirty-worktree' };
  const head = (args.head ?? '').trim();
  if (!isProductionGitSha(head)) return { gitSha: '', source: 'unresolved-head' };
  return { gitSha: head, source: 'git-head' };
}

/** Env SHA must be the SHA baked into the package. Mismatch or empty fails closed. */
export function revisionsAgree(packagedGitSha: string | null | undefined, envGitSha: string | null | undefined): boolean {
  const packaged = (packagedGitSha ?? '').trim();
  const env = (envGitSha ?? '').trim();
  return isProductionGitSha(packaged) && packaged === env;
}
