import Link from 'next/link';
import type { ReactNode } from 'react';

/** Page header shared by the empty and filled workspace. Title on the left, mode tabs on the right. */
export function WorkspaceHeader({
  sourceLabel = null,
  editedAfterXrayImport = false,
  modeSwitch,
}: {
  sourceLabel?: string | null;
  editedAfterXrayImport?: boolean;
  modeSwitch: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0" data-coachmark="workspace-intro">
        <p className="type-metadata">
          <Link href="/dashboard" className="text-[#075B5C] hover:underline">
            Tools
          </Link>
          <span className="mx-1.5">/</span>
          Parlay Workspace
        </p>
        <h1 className="mt-1 text-4xl font-black tracking-tight sm:text-5xl">
          <span className="text-[#55ddb1]">Parlay</span> <span className="text-[#063f46]">Workspace</span>
        </h1>
        <p className="type-secondary mt-0.5">
          {sourceLabel ? (
            <span aria-label="Parlay source">
              {sourceLabel}
              {editedAfterXrayImport ? ' · Edited after import' : ''}
            </span>
          ) : (
            'Organize, review, and refine your parlay with data-driven context.'
          )}
        </p>
      </div>
      <div className="shrink-0">{modeSwitch}</div>
    </header>
  );
}
