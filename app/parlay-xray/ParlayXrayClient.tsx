'use client';

import { useEffect, useReducer, useRef } from 'react';
import { ParlayXrayView } from '@/components/parlay-xray/ParlayXrayView';
import { isXrayDesignPreviewEnabled } from '@/lib/parlay-xray/copy';
import {
  createInitialXrayState,
  extractionStatusFromResult,
  reduceXrayState,
  type LegEdits,
} from '@/lib/parlay-xray/session';
import type { ExtractedParlayLeg, UploadErrorCode, UploadedScreenshot } from '@/lib/parlay-xray/types';
import {
  PARLAY_XRAY_EXTRACT_COMPLETED,
  PARLAY_XRAY_EXTRACT_FAILED,
  PARLAY_XRAY_EXTRACT_STARTED,
  PARLAY_XRAY_UPLOAD_SELECTED,
  PARLAY_XRAY_UPLOAD_STARTED,
  PARLAY_XRAY_VIEWED,
  parlayXraySurfaceProperties,
} from '@/lib/product-analytics/parlay-xray-events';
import { trackEvent } from '@/lib/product-analytics/track-event';

const SUCCESS_RESULTS = new Set(['SUCCESS', 'PARTIAL', 'NEEDS_CONFIRMATION', 'NO_LEGS_FOUND']);

export function ParlayXrayClient() {
  const [state, dispatch] = useReducer(reduceXrayState, undefined, createInitialXrayState);
  const objectUrlRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const extractingRef = useRef(false);
  const headshotAttemptedRef = useRef<Set<string>>(new Set());
  const headshotLegKeyRef = useRef('');

  useEffect(() => {
    trackEvent(PARLAY_XRAY_VIEWED, parlayXraySurfaceProperties);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/parlay-xray/quota')
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { quota?: { used: number; limit: number; remaining: number } };
        if (cancelled || !body.quota) return;
        dispatch({ type: 'SET_QUOTA', quota: body.quota });
      })
      .catch(() => {
        // Quota counter is optional; server remains source of truth on extract.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const previewFlag = new URLSearchParams(window.location.search).get('preview');
    if (!isXrayDesignPreviewEnabled(previewFlag)) return;
    let cancelled = false;
    void import('@/lib/parlay-xray/dev-fixture').then((mod) => {
      if (cancelled) return;
      if (previewFlag === 'partial') {
        const { parlay } = mod.buildPartialExtractionFixture();
        dispatch({ type: 'LOAD_PREVIEW', parlay, analysis: null, confirmed: false });
        return;
      }
      const { parlay, analysis } = mod.buildFullPreviewFixture();
      dispatch({ type: 'LOAD_PREVIEW', parlay, analysis, confirmed: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const legKey = state.parlay.legs.map((leg) => leg.id).join('|');
    if (legKey !== headshotLegKeyRef.current) {
      headshotLegKeyRef.current = legKey;
      headshotAttemptedRef.current.clear();
    }
    const missing = state.parlay.legs.filter(
      (leg) =>
        Boolean(leg.playerDisplayName.value) &&
        (leg.nbaPlayerId.status !== 'known' || !leg.nbaPlayerId.value)
    );
    if (missing.length === 0) return;
    const names = [
      ...new Set(
        missing
          .map((leg) => leg.playerDisplayName.value!)
          .filter((name) => {
            const key = name.toLowerCase();
            if (headshotAttemptedRef.current.has(key)) return false;
            headshotAttemptedRef.current.add(key);
            return true;
          })
      ),
    ];
    if (names.length === 0) return;
    let cancelled = false;
    void fetch('/api/parlay-xray/headshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          players?: Array<{ extracted?: string; nbaPlayerId?: string | null }>;
        };
        const byName = new Map(
          (body.players ?? [])
            .filter((row) => row.extracted && row.nbaPlayerId)
            .map((row) => [row.extracted!.toLowerCase(), row.nbaPlayerId as string])
        );
        const ids: Record<string, string> = {};
        for (const leg of missing) {
          const name = leg.playerDisplayName.value?.toLowerCase();
          const nbaId = name ? byName.get(name) : null;
          if (nbaId) ids[leg.id] = nbaId;
        }
        if (Object.keys(ids).length > 0 && !cancelled) {
          dispatch({ type: 'ATTACH_HEADSHOTS', ids });
        }
      })
      .catch(() => {
        // Portraits are optional; initials remain if lookup fails.
      });
    return () => {
      cancelled = true;
    };
  }, [state.parlay.legs]);

  const replaceObjectUrl = (next: string | null) => {
    if (objectUrlRef.current && objectUrlRef.current !== next) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = next;
  };

  const onSelected = (file: UploadedScreenshot) => {
    replaceObjectUrl(file.objectUrl || null);
    trackEvent(PARLAY_XRAY_UPLOAD_SELECTED, parlayXraySurfaceProperties);
    dispatch({ type: 'FILE_SELECTED', file });
  };

  const onRejected = (code: Extract<UploadErrorCode, 'unsupported_file' | 'file_too_large'>) => {
    dispatch({ type: 'FILE_REJECTED', code });
  };

  const onRemove = () => {
    replaceObjectUrl(null);
    dispatch({ type: 'FILE_REMOVED' });
  };

  const onEditLeg = (legId: string, edits: LegEdits) => {
    dispatch({ type: 'UPDATE_LEG', legId, edits });
  };

  const onUploadStarted = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent(PARLAY_XRAY_UPLOAD_STARTED, parlayXraySurfaceProperties);
  };

  const onExtract = () => {
    const image = state.parlay.uploadedImage;
    if (!image?.objectUrl || extractingRef.current) return;
    extractingRef.current = true;
    dispatch({ type: 'EXTRACT_STARTED' });
    trackEvent(PARLAY_XRAY_EXTRACT_STARTED, parlayXraySurfaceProperties);

    void (async () => {
      try {
        const blob = await fetch(image.objectUrl).then((res) => res.blob());
        const form = new FormData();
        form.append('image', blob, image.filename);
        const res = await fetch('/api/parlay-xray/extract', { method: 'POST', body: form });
        const body = (await res.json()) as {
          result?: string;
          message?: string;
          legs?: ExtractedParlayLeg[];
          quota?: { used: number; limit: number; remaining: number };
        };
        if (body.quota) dispatch({ type: 'SET_QUOTA', quota: body.quota });
        const result = body.result ?? 'INTERNAL_ERROR';
        const ok = SUCCESS_RESULTS.has(result);
        trackEvent(ok ? PARLAY_XRAY_EXTRACT_COMPLETED : PARLAY_XRAY_EXTRACT_FAILED, {
          surface: 'parlay_xray',
          result_category: result,
        });
        dispatch({
          type: 'SET_EXTRACTION',
          status: extractionStatusFromResult(result),
          legs: Array.isArray(body.legs) ? body.legs : [],
          notice: ok && result === 'SUCCESS' ? null : (body.message ?? null),
        });
      } catch {
        trackEvent(PARLAY_XRAY_EXTRACT_FAILED, {
          surface: 'parlay_xray',
          result_category: 'INTERNAL_ERROR',
        });
        dispatch({
          type: 'SET_EXTRACTION',
          status: 'failed',
          legs: [],
          notice: 'Screenshot analysis could not finish. Try again later.',
        });
      } finally {
        extractingRef.current = false;
      }
    })();
  };

  return (
    <ParlayXrayView
      state={state}
      onSelected={onSelected}
      onRejected={onRejected}
      onRemove={onRemove}
      onExtract={onExtract}
      onToggleEditing={() => dispatch({ type: 'TOGGLE_EDITING' })}
      onEditLeg={onEditLeg}
      onConfirm={() => dispatch({ type: 'CONFIRM_LEGS' })}
      onUploadStarted={onUploadStarted}
      showDesignPreviewLink={process.env.NODE_ENV !== 'production'}
    />
  );
}
