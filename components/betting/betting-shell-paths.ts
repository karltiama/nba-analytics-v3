/** Pathnames that should show the shared betting Header. */
export function shouldShowLayoutHeader(pathname: string): boolean {
  if (pathname === '/betting') return true;
  if (pathname.startsWith('/betting/games/')) return true;
  if (pathname.startsWith('/betting/props-explorer')) return true;
  if (pathname.startsWith('/betting/saved')) return true;
  if (pathname.startsWith('/betting/bet-slip-analyzer')) return true;
  if (pathname.startsWith('/betting/research')) return true;
  if (pathname.startsWith('/betting/paper')) return true;
  if (pathname.startsWith('/betting/profile')) return true;
  // Teams directory + profiles (outside /betting/* but part of primary nav)
  if (pathname === '/teams' || pathname.startsWith('/teams/')) return true;
  return false;
}
