'use client';

import { ContextCheckInstagramCard } from '@/components/content/context-check/ContextCheckInstagramCard';
import { toContextCheckCardViewModel } from '@/lib/content/context-check/view-model';
import { MOCK_RECENT_FORM_DIVERGENCE } from '@/lib/content/context-check/mocks';
import { INSTAGRAM_TYPE_VARIANTS } from '@/lib/content/context-check/instagram-type';

/**
 * Temporary admin-only comparison. Same Brunson snapshot, three type systems.
 * Not a public surface.
 */
export function InstagramTypographyPreview() {
  const vm = toContextCheckCardViewModel(MOCK_RECENT_FORM_DIVERGENCE, 'social');

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Typography Preview
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Temporary studio comparison. Same Jalen Brunson Instagram card. Layout, color, and
          content are identical — only typefaces and tracking change. Not shown to users.
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        {INSTAGRAM_TYPE_VARIANTS.map((variant) => (
          <div key={variant.id} className="min-w-0 space-y-3">
            <p className="text-xs font-medium text-foreground">{variant.label}</p>
            <ContextCheckInstagramCard vm={vm} typeVariant={variant.id} />
          </div>
        ))}
      </div>
    </section>
  );
}
