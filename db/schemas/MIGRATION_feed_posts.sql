-- Bet feed: self-reported bets posted to the dashboard feed. Safe to re-run.
--
-- Rules the app enforces (and the schema backs up):
-- 1) Posts are self-reported. Legs, lines, and odds are frozen at post time in legs_snapshot.
-- 2) Every leg's game must not have tipped off when the post is created (app check).
-- 3) At most 3 posts per user per ET calendar day: daily_slot in 1..3 + unique index.
--    Hidden posts keep their slot, so hiding never frees a post.
-- 4) No edits or deletes after posting. Owners may hide; the post still counts toward the record.
-- 5) A post (single or parlay) counts as ONE result in the record.
--
-- The Next.js pool uses a privileged role and bypasses RLS. App SQL must filter by the session user
-- for writes. RLS is defense in depth only.

create schema if not exists feed;

create table if not exists feed.posts (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  posted_at               timestamptz not null default now(),
  post_date_et            date not null,
  daily_slot              smallint not null,
  note                    text,
  legs_snapshot           jsonb not null,
  leg_count               smallint not null,
  combined_odds_american  integer,
  stake_units             numeric not null default 1,
  first_tip_at            timestamptz not null,
  status                  text not null default 'open',
  result                  text,
  profit_units            numeric,
  leg_results             jsonb,
  settled_at              timestamptz,
  hidden                  boolean not null default false,
  hidden_at               timestamptz,
  constraint feed_posts_status_chk check (status in ('open', 'settled')),
  constraint feed_posts_result_chk check (result is null or result in ('win', 'loss', 'push')),
  constraint feed_posts_daily_slot_chk check (daily_slot between 1 and 3),
  constraint feed_posts_legs_is_array check (jsonb_typeof(legs_snapshot) = 'array'),
  constraint feed_posts_leg_count_chk check (leg_count >= 1),
  constraint feed_posts_note_len_chk check (note is null or length(note) <= 280),
  constraint feed_posts_stake_chk check (stake_units > 0)
);

create unique index if not exists feed_posts_user_day_slot_uidx
  on feed.posts (user_id, post_date_et, daily_slot);

create index if not exists feed_posts_date_posted_idx
  on feed.posts (post_date_et, posted_at desc);

create index if not exists feed_posts_open_idx
  on feed.posts (first_tip_at)
  where status = 'open';

create index if not exists feed_posts_user_settled_idx
  on feed.posts (user_id)
  where status = 'settled';

create table if not exists feed.post_reports (
  post_id      uuid not null references feed.posts(id) on delete cascade,
  reporter_id  uuid not null references auth.users(id) on delete cascade,
  reason       text,
  created_at   timestamptz not null default now(),
  primary key (post_id, reporter_id),
  constraint feed_post_reports_reason_len_chk check (reason is null or length(reason) <= 280)
);

comment on table feed.posts is
  'Self-reported bets posted to the dashboard feed. One row = one record unit (single or parlay). Settled by /api/cron/paper-settle.';
comment on column feed.posts.legs_snapshot is
  'Frozen CanonicalBetLeg[] at post time. Never mutate.';
comment on column feed.posts.daily_slot is
  '1..3 within (user_id, post_date_et). The unique index enforces the daily cap under concurrency.';
comment on column feed.posts.leg_results is
  'Per-leg grades at settlement, same order as legs_snapshot: win | loss | push | void.';

alter table feed.posts enable row level security;
alter table feed.post_reports enable row level security;

drop policy if exists feed_posts_select_visible on feed.posts;
create policy feed_posts_select_visible
on feed.posts
for select
to authenticated
using (hidden = false or user_id = auth.uid());

drop policy if exists feed_posts_insert_own on feed.posts;
create policy feed_posts_insert_own
on feed.posts
for insert
to authenticated
with check (user_id = auth.uid());

-- No UPDATE / DELETE policies: hides and settlement go through the server pool only.

drop policy if exists feed_post_reports_insert_own on feed.post_reports;
create policy feed_post_reports_insert_own
on feed.post_reports
for insert
to authenticated
with check (reporter_id = auth.uid());
