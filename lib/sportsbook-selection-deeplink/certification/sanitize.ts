/**
 * Ensure certification artifacts never serialize credentials.
 */

const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|password|secret|credential)/i;

export function assertNoSecretsInReport(value: unknown, path = 'report'): void {
  if (value == null) return;
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(value) && value.length > 20) {
      // Allow field names in notes; block long secret-looking values.
      if (/^[a-f0-9]{20,}$/i.test(value) || value.includes('sk_') || value.includes('apiKey=')) {
        throw new Error(`Forbidden secret-like string at ${path}`);
      }
    }
    if (/apiKey=/i.test(value)) {
      throw new Error(`Forbidden apiKey query at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSecretsInReport(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k) && k !== 'apiKeyPresentInArtifact') {
        throw new Error(`Forbidden secret key name at ${path}.${k}`);
      }
      assertNoSecretsInReport(v, `${path}.${k}`);
    }
  }
}

export function stripApiKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('apiKey');
    return u.toString();
  } catch {
    return url.replace(/apiKey=[^&]+/gi, 'apiKey=REDACTED');
  }
}
