import {
  CHECKLIST_ITEM_IDS,
  COACHMARK_IDS,
  GUIDANCE_LEVELS,
  ONBOARDING_CHANGED_EVENT,
  ONBOARDING_STORAGE_KEY,
  PRIMARY_INTENTS,
  type ChecklistItemId,
  type CoachmarkId,
  type GuidanceLevel,
  type PrimaryIntent,
} from './contract';

export type OnboardingLocalState = {
  version: 2;
  completed: boolean;
  skipped: boolean;
  primaryIntent: PrimaryIntent | null;
  guidanceLevel: GuidanceLevel | null;
  dismissedCoachmarks: CoachmarkId[];
  checklist: Partial<Record<ChecklistItemId, boolean>>;
  checklistDismissed: boolean;
  existingPromptDismissed: boolean;
  existingPromptEligible: boolean;
  replay: boolean;
};

const EMPTY: OnboardingLocalState = {
  version: 2,
  completed: false,
  skipped: false,
  primaryIntent: null,
  guidanceLevel: null,
  dismissedCoachmarks: [],
  checklist: {},
  checklistDismissed: false,
  existingPromptDismissed: false,
  existingPromptEligible: false,
  replay: false,
};

function isIntent(value: unknown): value is PrimaryIntent {
  return typeof value === 'string' && (PRIMARY_INTENTS as readonly string[]).includes(value);
}

function isGuidance(value: unknown): value is GuidanceLevel {
  return typeof value === 'string' && (GUIDANCE_LEVELS as readonly string[]).includes(value);
}

function isCoachmark(value: unknown): value is CoachmarkId {
  return typeof value === 'string' && (COACHMARK_IDS as readonly string[]).includes(value);
}

function isChecklistId(value: unknown): value is ChecklistItemId {
  return typeof value === 'string' && (CHECKLIST_ITEM_IDS as readonly string[]).includes(value);
}

export function emptyOnboardingState(): OnboardingLocalState {
  return { ...EMPTY, dismissedCoachmarks: [], checklist: {} };
}

export function parseOnboardingState(raw: unknown): OnboardingLocalState {
  if (!raw || typeof raw !== 'object') return emptyOnboardingState();
  const row = raw as Record<string, unknown>;
  const dismissed = Array.isArray(row.dismissedCoachmarks)
    ? row.dismissedCoachmarks.filter(isCoachmark)
    : [];
  const checklist: Partial<Record<ChecklistItemId, boolean>> = {};
  if (row.checklist && typeof row.checklist === 'object') {
    for (const [key, value] of Object.entries(row.checklist as Record<string, unknown>)) {
      if (isChecklistId(key) && value === true) checklist[key] = true;
    }
  }
  return {
    version: 2,
    completed: row.completed === true,
    skipped: row.skipped === true,
    primaryIntent: isIntent(row.primaryIntent) ? row.primaryIntent : null,
    guidanceLevel: isGuidance(row.guidanceLevel) ? row.guidanceLevel : null,
    dismissedCoachmarks: dismissed,
    checklist,
    checklistDismissed: row.checklistDismissed === true,
    existingPromptDismissed: row.existingPromptDismissed === true,
    existingPromptEligible: row.existingPromptEligible === true,
    replay: row.replay === true,
  };
}

function readStore(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readOnboardingState(): OnboardingLocalState {
  const store = readStore();
  if (!store) return emptyOnboardingState();
  try {
    const raw = store.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return emptyOnboardingState();
    return parseOnboardingState(JSON.parse(raw));
  } catch {
    return emptyOnboardingState();
  }
}

export function writeOnboardingState(next: OnboardingLocalState): OnboardingLocalState {
  const store = readStore();
  if (store) {
    try {
      store.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode */
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ONBOARDING_CHANGED_EVENT));
  }
  return next;
}

export function patchOnboardingState(
  patch: Partial<OnboardingLocalState>
): OnboardingLocalState {
  return writeOnboardingState({ ...readOnboardingState(), ...patch, version: 2 });
}

export function markOnboardingComplete(input: {
  skipped: boolean;
  primaryIntent: PrimaryIntent | null;
  guidanceLevel: GuidanceLevel | null;
}): OnboardingLocalState {
  return patchOnboardingState({
    completed: true,
    skipped: input.skipped,
    primaryIntent: input.primaryIntent,
    guidanceLevel: input.guidanceLevel,
    replay: false,
  });
}

export function dismissCoachmark(id: CoachmarkId): OnboardingLocalState {
  const current = readOnboardingState();
  if (current.dismissedCoachmarks.includes(id)) return current;
  return patchOnboardingState({
    dismissedCoachmarks: [...current.dismissedCoachmarks, id],
  });
}

export function markChecklistItem(id: ChecklistItemId): OnboardingLocalState {
  const current = readOnboardingState();
  if (current.checklist[id]) return current;
  return patchOnboardingState({
    checklist: { ...current.checklist, [id]: true },
  });
}

export function requestTourReplay(): OnboardingLocalState {
  return patchOnboardingState({
    replay: true,
    checklistDismissed: false,
    dismissedCoachmarks: [],
  });
}
