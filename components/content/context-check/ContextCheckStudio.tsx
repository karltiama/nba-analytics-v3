'use client';

import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ContextCheckCard } from '@/components/content/context-check/ContextCheckCard';
import { ManualContextCheckForm } from '@/components/content/context-check/ManualContextCheckForm';
import { SuggestedCandidates } from '@/components/content/context-check/SuggestedCandidates';
import {
  generateContextCheckFromManual,
  isGeneratedContextCheck,
} from '@/lib/content/context-check/generate-from-manual';
import { MOCK_CANDIDATES } from '@/lib/content/context-check/mocks';
import { validateManualContextCheckForm } from '@/lib/content/context-check/validate';
import type { ManualFormValues } from '@/lib/content/context-check/validate';
import type {
  ContextCheckCardVariant,
  ContextCheckData,
} from '@/lib/content/context-check/types';
import { InstagramTypographyPreview } from '@/components/content/context-check/InstagramTypographyPreview';
import {
  DEFAULT_INSTAGRAM_TYPE_VARIANT,
  INSTAGRAM_TYPE_VARIANTS,
  type InstagramTypeVariantId,
} from '@/lib/content/context-check/instagram-type';

function PersistencePlaceholder({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function ContextCheckStudio() {
  const candidates = useMemo(() => MOCK_CANDIDATES, []);
  const [preview, setPreview] = useState<ContextCheckData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [variant, setVariant] = useState<ContextCheckCardVariant>('social');
  const [typeVariant, setTypeVariant] = useState<InstagramTypeVariantId>(
    DEFAULT_INSTAGRAM_TYPE_VARIANT
  );
  const [studioTab, setStudioTab] = useState('suggested');
  const [isGenerating, setIsGenerating] = useState(false);

  function showPreview(data: ContextCheckData) {
    setPreviewError(null);
    setPreview(data);
  }

  function handleManualSubmit(values: ManualFormValues) {
    const parsed = validateManualContextCheckForm(values);
    if (!parsed.ok) {
      setPreviewError('Fix the form errors before generating a preview.');
      return;
    }

    setIsGenerating(true);
    setPreviewError(null);

    window.setTimeout(() => {
      const result = generateContextCheckFromManual(parsed.input);
      setIsGenerating(false);
      if (!isGeneratedContextCheck(result)) {
        setPreview(null);
        setPreviewError(result.error);
        return;
      }
      showPreview(result);
    }, 150);
  }

  return (
    <div
      className={
        studioTab === 'type'
          ? 'min-w-0'
          : 'grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]'
      }
    >
      <div className="min-w-0">
        <Tabs value={studioTab} onValueChange={setStudioTab}>
          <TabsList variant="line" className="w-full max-w-full flex-wrap justify-start">
            <TabsTrigger value="suggested">Suggested</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
            <TabsTrigger value="posted">Posted</TabsTrigger>
            <TabsTrigger value="type">Type</TabsTrigger>
          </TabsList>

          <TabsContent value="suggested" className="mt-6">
            <SuggestedCandidates candidates={candidates} onPreview={(c) => showPreview(c.data)} />
          </TabsContent>

          <TabsContent value="manual" className="mt-6">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Manual creation
              </h2>
              <ManualContextCheckForm onSubmit={handleManualSubmit} isGenerating={isGenerating} />
            </div>
          </TabsContent>

          <TabsContent value="drafts" className="mt-6">
            <PersistencePlaceholder
              title="Drafts"
              body="Draft persistence is not part of v1. Future drafts will store a frozen ContextCheckData snapshot rather than live-querying later games."
            />
          </TabsContent>

          <TabsContent value="posted" className="mt-6">
            <PersistencePlaceholder
              title="Posted"
              body="Public auto-publishing is intentionally not part of v1. The intended workflow is candidate detection, human review, then publish — never database straight to social media."
            />
          </TabsContent>

          <TabsContent value="type" className="mt-6">
            <InstagramTypographyPreview />
          </TabsContent>
        </Tabs>
      </div>

      {studioTab !== 'type' && (
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Preview
            </h2>
            {variant === 'social' ? (
              <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Instagram · 1080 × 1350 · 4:5
              </p>
            ) : (
              <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Web
              </p>
            )}
          </div>
          <div className="flex rounded-md border border-white/10 p-0.5" role="group" aria-label="Card variant">
            {(
              [
                { id: 'web' as const, label: 'Web' },
                { id: 'social' as const, label: 'Instagram' },
              ]
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={variant === option.id}
                onClick={() => setVariant(option.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  variant === option.id
                    ? 'bg-neon-cyan text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {variant === 'social' && (
          <div
            className="mb-3 flex flex-col gap-1"
            role="group"
            aria-label="Typography variant"
          >
            {INSTAGRAM_TYPE_VARIANTS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={typeVariant === option.id}
                onClick={() => setTypeVariant(option.id)}
                className={`rounded-md px-2.5 py-1 text-left text-xs ${
                  typeVariant === option.id
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {isGenerating ? (
          <div className="space-y-3 rounded-xl border border-white/10 p-4" aria-busy="true" aria-live="polite">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-24 w-full" />
            <span className="sr-only">Generating Context Check preview</span>
          </div>
        ) : previewError ? (
          <p className="text-sm text-destructive" role="alert">
            {previewError}
          </p>
        ) : preview ? (
          <div className={variant === 'social' ? 'mx-auto w-full max-w-[432px]' : undefined}>
            <ContextCheckCard data={preview} variant={variant} typeVariant={typeVariant} />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-white/15 p-6 text-sm text-muted-foreground">
            Preview a suggested candidate or generate one from the manual form. The same
            ContextCheckCard is used for both.
          </p>
        )}
      </aside>
      )}
    </div>
  );
}
