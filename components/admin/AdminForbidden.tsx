export function AdminForbidden({
  reason,
  email,
}: {
  reason: 'forbidden' | 'allowlist_empty';
  email: string | null;
}) {
  return (
    <main className="max-w-xl mx-auto px-4 py-16 space-y-3">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Internal · admin</p>
      <h1 className="text-2xl font-bold text-white">Forbidden</h1>
      {reason === 'allowlist_empty' ? (
        <p className="text-sm text-muted-foreground">
          The admin allowlist is empty. In <code className="text-white/80">.env</code> or{' '}
          <code className="text-white/80">.env.local</code> set{' '}
          <code className="text-white/80">ADMIN_EMAILS=your-login-email</code> (plural), then restart{' '}
          <code className="text-white/80">npm run dev</code>.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Signed in as {email ?? 'an account with no email'} — that address is not on{' '}
          <code className="text-white/80">ADMIN_EMAILS</code>. Use the same email you sign in with, then restart the
          dev server.
        </p>
      )}
    </main>
  );
}
