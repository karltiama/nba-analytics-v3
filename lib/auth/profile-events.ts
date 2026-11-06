/** Window event fired after the user's profile is saved, so the header can refresh its name without a reload. */
export const PROFILE_UPDATED_EVENT = 'cc:profile-updated';

export function notifyProfileUpdated(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
}
