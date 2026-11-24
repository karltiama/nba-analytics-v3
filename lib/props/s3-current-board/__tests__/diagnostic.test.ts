import { readFileSync } from 'node:fs';
import path from 'node:path';

import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import { diagnoseCurrentBoard } from '@/lib/props/s3-current-board/diagnostic';
import type { CurrentPointer } from '@/lib/props/s3-current-board/pointer';
import { currentPropsSource } from '@/lib/props/s3-current-board/source';
import { openWebsiteCurrentBoardStore } from '@/lib/props/s3-current-board/website-store';
import {
  envelopeToObjectMeta,
  gunzipEnvelope,
  s3UserMetadata,
} from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';

const FIXTURE = path.join(__dirname, 'fixtures', 'bos-was-21718182');
const STALE_AT = '2026-11-24T16:00:00.000Z';

function fixtureStore(commands: string[]) {
  const pointer = JSON.parse(readFileSync(path.join(FIXTURE, 'pointer.json'), 'utf8')) as CurrentPointer;
  const archive = readFileSync(path.join(FIXTURE, 'archive.json.gz'));
  const objects = new Map<string, { body: Buffer; metadata: Record<string, string> }>([
    [`current/source=balldontlie/league=nba/entity=player_prop_current/game_id=${pointer.gameId}/pointer.json`, {
      body: readFileSync(path.join(FIXTURE, 'pointer.json')),
      metadata: {},
    }],
    [pointer.manifestKey, { body: readFileSync(path.join(FIXTURE, 'manifest.json')), metadata: {} }],
    [pointer.archiveKey, { body: archive, metadata: s3UserMetadata(envelopeToObjectMeta(gunzipEnvelope(archive))) }],
  ]);
  const client = {
    async send(command: GetObjectCommand) {
      commands.push(command.constructor.name);
      const found = objects.get(command.input.Key ?? '');
      if (!found) {
        const error = new Error('not authorized to perform: s3:ListBucket on resource');
        Object.assign(error, { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
        throw error;
      }
      return {
        ETag: '"fixture"',
        Metadata: found.metadata,
        Body: { transformToByteArray: async () => new Uint8Array(found.body) },
      };
    },
  } as unknown as S3Client;
  return { pointer, store: openWebsiteCurrentBoardStore({ client }) };
}

describe('current-board diagnostic', () => {
  it('verifies the historical BOS @ WAS snapshot and classifies it as stale', async () => {
    const commands: string[] = [];
    const { pointer, store } = fixtureStore(commands);
    const status = await diagnoseCurrentBoard({ store, gameId: pointer.gameId, now: STALE_AT });
    expect(currentPropsSource()).toBe('postgres');
    expect(status).toEqual({
      gameId: '21718182',
      pointer: 'present',
      evidence: 'verified',
      identityMatch: true,
      checksumMatch: true,
      observationClock: 'RESPONSE_RECEIVED',
      pullRunId: 717,
      observedAt: '2026-11-24T14:11:07.929Z',
      classification: 'stale',
    });
    expect(commands.every((name) => name === 'GetObjectCommand')).toBe(true);
    expect(JSON.stringify(status)).not.toMatch(/oddsAmerican|eyJ|"rows"/);
    const expired = await diagnoseCurrentBoard({ store, gameId: pointer.gameId, now: pointer.gameStartTime });
    expect(expired.classification).toBe('expired');
    expect(expired.evidence).toBe('verified');
  });
});
