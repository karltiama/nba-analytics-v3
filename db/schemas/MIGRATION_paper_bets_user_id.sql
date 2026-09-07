-- WP6.1: paper.bets ownership. Safe to re-run.
-- Existing rows keep user_id NULL (unknown owner). Do not backfill by guessing.
-- App SQL must still filter by authenticated user_id; RLS is defense in depth only.
-- The Next.js pool uses a privileged role and bypasses RLS.

alter table paper.bets
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists paper_bets_user_id_created_idx
  on paper.bets (user_id, created_at desc);

comment on column paper.bets.user_id is
  'Authenticated owner (auth.users.id). NULL = pre-multi-user / unknown owner; hidden from user-facing queries.';

comment on table paper.bets is
  'Paper trades snapshot from Props Explorer. Each row belongs to at most one user_id; settlement must not overwrite owner.';

alter table paper.bets enable row level security;

drop policy if exists paper_bets_select_own on paper.bets;
create policy paper_bets_select_own
on paper.bets
for select
using (user_id = auth.uid());

drop policy if exists paper_bets_insert_own on paper.bets;
create policy paper_bets_insert_own
on paper.bets
for insert
with check (user_id = auth.uid());

drop policy if exists paper_bets_update_own on paper.bets;
create policy paper_bets_update_own
on paper.bets
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists paper_bets_delete_own on paper.bets;
create policy paper_bets_delete_own
on paper.bets
for delete
using (user_id = auth.uid());
