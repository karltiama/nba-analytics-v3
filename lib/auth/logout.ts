/** Public page after sign-out. A full navigation drops the protected document. */
export const LOGGED_OUT_PATH = '/login';

export async function signOutToLogin(signOut: () => Promise<unknown>): Promise<string> {
  try {
    await signOut();
  } catch {
    // Still leave the protected page if the provider call fails.
  }
  return LOGGED_OUT_PATH;
}
