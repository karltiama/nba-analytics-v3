import Link from 'next/link';
import {
  explorerReturnHref,
  gameDetailHref,
  parsePlayerReturnContext,
  slateHref,
  type PlayerReturnContext,
} from '@/lib/betting/research-journey';

export function PlayerResearchReturnBar({ ctx }: { ctx: PlayerReturnContext }) {
  const hasExplorer = Boolean(ctx.from === 'explorer' && (ctx.date || ctx.gameId));
  if (!hasExplorer && !ctx.gameId) return null;

  return (
    <div className="glass-card rounded-xl border border-white/10 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {hasExplorer ? (
        <Link href={explorerReturnHref(ctx)} className="text-[#00d4ff] hover:underline font-medium">
          ← Back to Props Explorer
        </Link>
      ) : (
        <Link href={slateHref(ctx.date)} className="text-[#00d4ff] hover:underline font-medium">
          ← Betting Dashboard
        </Link>
      )}
      {ctx.gameId ? (
        <Link href={gameDetailHref(ctx.gameId)} className="text-muted-foreground hover:text-white hover:underline">
          View game
        </Link>
      ) : null}
      {ctx.date ? (
        <span className="text-muted-foreground">
          Research date {ctx.date}
          {ctx.propType ? ` · ${ctx.propType.replace(/_/g, ' ')}` : ''}
          {ctx.side ? ` ${ctx.side}` : ''}
          {ctx.lineValue ? ` ${ctx.lineValue}` : ''}
        </span>
      ) : null}
    </div>
  );
}

export function playerReturnContextFromSearch(searchParams: {
  from?: string;
  date?: string;
  game_id?: string;
  prop_type?: string;
  side?: string;
  sportsbook?: string;
  line?: string;
}): PlayerReturnContext {
  return parsePlayerReturnContext({
    from: searchParams.from,
    date: searchParams.date,
    game_id: searchParams.game_id,
    prop_type: searchParams.prop_type,
    side: searchParams.side,
    sportsbook: searchParams.sportsbook,
    line: searchParams.line,
  });
}
