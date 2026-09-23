/**
 * In-memory preview writes. Never touches Stripe, email, auth, or Supabase.
 */

import { previewId } from './ids';

export type PreviewSavedProp = {
  id: string;
  gameId: string;
  playerId: number;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  side: string | null;
  lineValue: number | null;
  snapshotAt: string | null;
};

export type PreviewPaperBet = {
  id: string;
  gameId: string;
  playerId: number;
  playerName: string | null;
  propType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
};

let savedProps: PreviewSavedProp[] = [];
let paperBets: PreviewPaperBet[] = [];
let savedSeq = 0;
let paperSeq = 0;

export function resetPreviewPersistenceForTests(): void {
  savedProps = [];
  paperBets = [];
  savedSeq = 0;
  paperSeq = 0;
}

export function listPreviewSavedProps(): PreviewSavedProp[] {
  return savedProps.map((row) => ({ ...row }));
}

export function savePreviewProp(input: Omit<PreviewSavedProp, 'id'>): PreviewSavedProp {
  savedSeq += 1;
  const row: PreviewSavedProp = { ...input, id: previewId(`saved-${savedSeq}`) };
  savedProps = [...savedProps, row];
  return { ...row };
}

export function deletePreviewSavedProp(id: string): boolean {
  const next = savedProps.filter((row) => row.id !== id);
  const removed = next.length !== savedProps.length;
  savedProps = next;
  return removed;
}

export function listPreviewPaperBets(): PreviewPaperBet[] {
  return paperBets.map((row) => ({ ...row }));
}

export function savePreviewPaperBet(input: Omit<PreviewPaperBet, 'id'>): PreviewPaperBet {
  paperSeq += 1;
  const row: PreviewPaperBet = { ...input, id: previewId(`paper-${paperSeq}`) };
  paperBets = [...paperBets, row];
  return { ...row };
}
