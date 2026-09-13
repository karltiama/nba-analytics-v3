export function LandingHeroPlayerCard() {
  return (
    <article className="w-full rounded-2xl bg-white px-4 py-4 shadow-[0_18px_40px_rgba(6,63,70,0.08)] sm:px-5 sm:py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#4a6366]">
            Featured Prop
          </p>
          <h2 className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-[#063f46]">
            Jayson Tatum
          </h2>
          <p className="text-sm text-[#4a6366]">BOS · SF</p>
        </div>
        <span className="shrink-0 rounded-full bg-[#55ddb1]/25 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#063f46]">
          Hot
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#4a6366]">PTS</p>
          <p className="text-2xl font-extrabold tracking-tight text-[#063f46]">27.5</p>
          <p className="text-xs font-bold text-[#0a8f6c]">OVER</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#4a6366]">REB</p>
          <p className="text-2xl font-extrabold tracking-tight text-[#063f46]">8.5</p>
          <p className="text-xs font-bold text-[#0a8f6c]">OVER</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#4a6366]">AST</p>
          <p className="text-2xl font-extrabold tracking-tight text-[#063f46]">5.5</p>
          <p className="text-xs font-bold text-[#0a8f6c]">OVER</p>
        </div>
      </div>
    </article>
  );
}
