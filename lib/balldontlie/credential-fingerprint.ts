import { createHash } from 'node:crypto';

/** One-way compare token. Never log the input. */
export function fingerprintSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 12);
}

export type BdlKeyInspection = {
  present: boolean;
  emptyAfterTrim: boolean;
  hadSurroundingWhitespace: boolean;
  hadInternalNewline: boolean;
  bearerPrefix: boolean;
  fingerprint: string | null;
};

export function inspectBdlApiKey(raw: string | undefined | null): BdlKeyInspection {
  const present = raw != null && raw.length > 0;
  const trimmed = (raw ?? '').trim();
  const bearerPrefix = /^bearer\s+/i.test(trimmed);
  const material = bearerPrefix ? trimmed.replace(/^bearer\s+/i, '').trim() : trimmed;
  return {
    present,
    emptyAfterTrim: present && material.length === 0,
    hadSurroundingWhitespace: present && raw !== (raw ?? '').trim(),
    hadInternalNewline: present && /[\r\n]/.test(raw ?? ''),
    bearerPrefix,
    fingerprint: material ? fingerprintSecret(material) : null,
  };
}

/** BALLDONTLIE expects the raw key in Authorization, not `Bearer <key>`. */
export function bdlAuthorizationHeader(raw: string): { Authorization: string } {
  const inspected = inspectBdlApiKey(raw);
  if (!inspected.present || inspected.emptyAfterTrim || !inspected.fingerprint) {
    throw new Error('BALLDONTLIE_API_KEY missing (value not printed)');
  }
  const trimmed = raw.trim().replace(/^bearer\s+/i, '').trim();
  return { Authorization: trimmed };
}

export function assignFingerprintClusters(
  labeled: Array<{ label: string; fingerprint: string | null }>
): Record<string, string> {
  const clusterByFp = new Map<string, string>();
  let n = 0;
  const out: Record<string, string> = {};
  for (const row of labeled) {
    if (!row.fingerprint) {
      out[row.label] = 'ABSENT';
      continue;
    }
    let cluster = clusterByFp.get(row.fingerprint);
    if (!cluster) {
      n += 1;
      cluster = `cluster-${String.fromCharCode(64 + n)}`;
      clusterByFp.set(row.fingerprint, cluster);
    }
    out[row.label] = cluster;
  }
  return out;
}
