import { describe, expect, it } from 'vitest';
import {
  assignFingerprintClusters,
  bdlAuthorizationHeader,
  fingerprintSecret,
  inspectBdlApiKey,
} from '../credential-fingerprint';

describe('credential-fingerprint', () => {
  it('is stable and one-way for a dummy secret', () => {
    expect(fingerprintSecret('dummy-test-key')).toBe(fingerprintSecret('dummy-test-key'));
    expect(fingerprintSecret('dummy-test-key')).toHaveLength(12);
    expect(fingerprintSecret('dummy-test-key')).not.toBe(fingerprintSecret('other-dummy'));
  });

  it('flags whitespace, newlines, and Bearer prefixes without echoing the secret', () => {
    const padded = inspectBdlApiKey('  dummy-test-key  ');
    expect(padded.hadSurroundingWhitespace).toBe(true);
    expect(padded.bearerPrefix).toBe(false);
    expect(padded.fingerprint).toBe(fingerprintSecret('dummy-test-key'));

    const bearer = inspectBdlApiKey('Bearer dummy-test-key');
    expect(bearer.bearerPrefix).toBe(true);
    expect(bearer.fingerprint).toBe(fingerprintSecret('dummy-test-key'));

    const nl = inspectBdlApiKey('dummy-test-key\n');
    expect(nl.hadInternalNewline).toBe(true);
    expect(nl.hadSurroundingWhitespace).toBe(true);
  });

  it('builds raw Authorization without duplicating Bearer', () => {
    expect(bdlAuthorizationHeader('Bearer dummy-test-key')).toEqual({
      Authorization: 'dummy-test-key',
    });
    expect(bdlAuthorizationHeader(' dummy-test-key\n')).toEqual({
      Authorization: 'dummy-test-key',
    });
  });

  it('clusters equal fingerprints', () => {
    const clusters = assignFingerprintClusters([
      { label: 'a', fingerprint: fingerprintSecret('x') },
      { label: 'b', fingerprint: fingerprintSecret('x') },
      { label: 'c', fingerprint: fingerprintSecret('y') },
      { label: 'd', fingerprint: null },
    ]);
    expect(clusters.a).toBe('cluster-A');
    expect(clusters.b).toBe('cluster-A');
    expect(clusters.c).toBe('cluster-B');
    expect(clusters.d).toBe('ABSENT');
  });
});
