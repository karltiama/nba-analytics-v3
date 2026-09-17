export class OwlsInsightError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    args?: { status?: number | null; code?: string | null; retryAfterMs?: number | null }
  ) {
    super(message);
    this.name = 'OwlsInsightError';
    this.status = args?.status ?? null;
    this.code = args?.code ?? null;
    this.retryAfterMs = args?.retryAfterMs ?? null;
  }
}

export class OwlsAuthenticationError extends OwlsInsightError {
  constructor(message = 'Owls Insight authentication failed') {
    super(message, { status: 401, code: 'UNAUTHORIZED' });
    this.name = 'OwlsAuthenticationError';
  }
}

export class OwlsForbiddenError extends OwlsInsightError {
  constructor(message = 'Owls Insight rejected this endpoint for the current tier') {
    super(message, { status: 403, code: 'FORBIDDEN' });
    this.name = 'OwlsForbiddenError';
  }
}

export class OwlsRateLimitError extends OwlsInsightError {
  constructor(message: string, retryAfterMs: number | null, code: string | null = null) {
    super(message, { status: 429, code: code ?? 'RATE_LIMIT', retryAfterMs });
    this.name = 'OwlsRateLimitError';
  }
}

export class OwlsServiceBusyError extends OwlsInsightError {
  constructor(message: string, retryAfterMs: number | null) {
    super(message, { status: 503, code: 'SERVICE_UNAVAILABLE', retryAfterMs });
    this.name = 'OwlsServiceBusyError';
  }
}

export function isOwlsAbortError(err: unknown): boolean {
  if (!(err instanceof OwlsInsightError)) return false;
  const status = err.status;
  if (status == null) return false;
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

export class OwlsExecuteRequiredError extends OwlsInsightError {
  constructor(message = 'Network Owls requests require --execute') {
    super(message, { code: 'EXECUTE_REQUIRED' });
    this.name = 'OwlsExecuteRequiredError';
  }
}

export class OwlsApiKeyRequiredError extends OwlsInsightError {
  constructor(message = 'OWLS_API_KEY is required for --execute') {
    super(message, { code: 'API_KEY_REQUIRED' });
    this.name = 'OwlsApiKeyRequiredError';
  }
}
