import { describe, expect, it } from 'vitest';
import { getGoogleClientId, GOOGLE_GSI_SCRIPT_SRC } from '../google-identity';

describe('google identity helpers', () => {
  it('reads NEXT_PUBLIC_GOOGLE_CLIENT_ID when present', () => {
    expect(getGoogleClientId({ NEXT_PUBLIC_GOOGLE_CLIENT_ID: ' abc.apps.googleusercontent.com ' })).toBe(
      'abc.apps.googleusercontent.com'
    );
    expect(getGoogleClientId({})).toBeNull();
    expect(getGoogleClientId({ NEXT_PUBLIC_GOOGLE_CLIENT_ID: '   ' })).toBeNull();
  });

  it('points at the official Google Identity Services script', () => {
    expect(GOOGLE_GSI_SCRIPT_SRC).toBe('https://accounts.google.com/gsi/client');
  });
});
