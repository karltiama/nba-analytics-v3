import { readTextIfExists } from '@/lib/model-lab/fs';
import type { RegistryEntry } from '@/lib/model-lab/types';

export function loadNotesMarkdown(entry: RegistryEntry): string | null {
  const text = readTextIfExists(entry.notesRelPath);
  if (text == null) return null;
  const trimmed = text.trim();
  return trimmed.length ? trimmed : null;
}
