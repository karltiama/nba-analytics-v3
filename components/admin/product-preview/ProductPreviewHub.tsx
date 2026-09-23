import Link from 'next/link';
import { isPublicXrayExtractionReady } from '@/lib/onboarding/contract';
import {
  PRODUCT_PREVIEW_FIXTURE,
  PROPS_HISTORICAL_PREVIEW_HREF,
  WORKSPACE_HISTORICAL_PREVIEW_HREF,
  XRAY_REPLAY_PREVIEW_HREF,
} from '@/lib/parlay/preview-fixture';
import { PREVIEW_GAMES } from '@/lib/preview/catalog';
import { PREVIEW_SCENARIOS, previewHref, previewScenarioLabel } from '@/lib/preview/scenario';

const CARDS = [
  {
    title: 'Props Explorer Preview',
    purpose: 'Discovery → Add to Parlay → Workspace',
    status: [
      `Historical fixture · ${PRODUCT_PREVIEW_FIXTURE.slateLabel}`,
      `${PRODUCT_PREVIEW_FIXTURE.dateLabel} · game ${PRODUCT_PREVIEW_FIXTURE.gameId}`,
      'Data mode: historical · No provider call',
    ],
    href: PROPS_HISTORICAL_PREVIEW_HREF,
    cta: 'Open Props Preview',
  },
  {
    title: 'Parlay XRay Preview',
    purpose: 'Import → review → correct → Confirm → Workspace',
    status: [
      'Certified X3F replay fixture',
      'Fixture extraction · OpenAI disabled',
      'Luka OCR typo still requires correction',
    ],
    href: XRAY_REPLAY_PREVIEW_HREF,
    cta: 'Open XRay Preview',
  },
  {
    title: 'Parlay Workspace Preview',
    purpose: 'Review seeded legs → Analyze with Court Context',
    status: [
      `Canonical ${PRODUCT_PREVIEW_FIXTURE.legCount}-leg fixture`,
      'Isolated from live parlay state',
      'Historical analysis · No provider call',
    ],
    href: WORKSPACE_HISTORICAL_PREVIEW_HREF,
    cta: 'Open Workspace Preview',
  },
] as const;

export function ProductPreviewHub() {
  return (
    <main className="min-h-screen bg-[#f7f9f7] text-[#063f46]">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-[#8aa0a3]">
            Internal · Preview · not indexed
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Product Preview</h1>
          <p className="max-w-2xl text-sm text-[#4a6366]">
            Deterministic fixtures for Props Explorer, Parlay XRay, and Parlay Workspace. These
            links do not enable public extraction, live analysis, or checkout.
          </p>
          <p className="text-xs text-[#4a6366]">
            Preview available: yes (historical fixtures). Product ready (public XRay extraction):{' '}
            {isPublicXrayExtractionReady() ? 'yes' : 'no'}.
          </p>
        </header>

        <ul className="grid grid-cols-1 gap-4">
          {CARDS.map((card) => (
            <li
              key={card.href}
              className="rounded-2xl border border-[#DCE9EA] bg-white p-5 shadow-sm"
            >
              <h2 className="text-base font-semibold">{card.title}</h2>
              <p className="text-sm text-[#4a6366] mt-1">{card.purpose}</p>
              <ul className="mt-3 space-y-1 text-xs text-[#4a6366]">
                {card.status.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Link
                href={card.href}
                className="mt-4 inline-flex items-center justify-center min-h-[44px] rounded-xl bg-[#063f46] px-4 text-sm font-semibold text-white hover:bg-[#075B5C]"
              >
                {card.cta}
              </Link>
            </li>
          ))}
        </ul>

        <section className="rounded-2xl border border-[#DCE9EA] bg-white p-5">
          <h2 className="text-base font-semibold">UI preview scenarios</h2>
          <p className="text-sm text-[#4a6366] mt-1">
            Same production screens, deterministic fixtures. Add <span className="font-mono">?preview=</span>{' '}
            to a route. These links do not write production data.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {PREVIEW_SCENARIOS.map((scenario) => (
              <li key={scenario} className="flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-semibold w-28">{previewScenarioLabel(scenario)}</span>
                <Link className="text-[#075B5C] underline" href={previewHref('/', scenario)}>
                  Landing
                </Link>
                <Link
                  className="text-[#075B5C] underline"
                  href={previewHref(`/betting/props-explorer?date=2026-04-02&game_id=${PREVIEW_GAMES[0].gameId}`, scenario)}
                >
                  Props
                </Link>
                <Link className="text-[#075B5C] underline" href={previewHref('/wowy', scenario)}>
                  WOWY
                </Link>
                <Link
                  className="text-[#075B5C] underline"
                  href={previewHref(`/betting/games/${PREVIEW_GAMES[0].gameId}`, scenario)}
                >
                  Game
                </Link>
                <Link className="text-[#075B5C] underline" href={previewHref('/parlay-xray', scenario)}>
                  X-Ray
                </Link>
                <Link className="text-[#075B5C] underline" href={previewHref('/parlay-workspace', scenario)}>
                  Workspace
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-sm text-[#4a6366]">
          Full Props → Workspace flow:{' '}
          <Link href={PROPS_HISTORICAL_PREVIEW_HREF} className="text-[#075B5C] underline">
            Open Props Preview
          </Link>
          , then Add to Parlay.
        </p>
        <section className="rounded-2xl border border-[#DCE9EA] bg-white p-5">
          <h2 className="text-base font-semibold">Onboarding guidance QA</h2>
          <p className="text-sm text-[#4a6366] mt-1">
            Open a preview card to see guided coachmarks on these fixture routes. Dismissals stay
            on the preview session. Preview Analyze / Add does not complete live checklist items,
            replay production Help, or change onboarding answers.
          </p>
        </section>
      </div>
    </main>
  );
}
