# Local-only check of ROLLBACK_player_prop_observation_clock.sql against stub tables (no production data).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/observation-clock-rollback/verify-rollback.ps1
# Needs a local PostgreSQL 17 install. Never point this at a shared or production database.
param([string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin')
$ErrorActionPreference = 'Stop'
$bin = $PgBin
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path "$root\..\..\..").Path
$work = "$repo\tmp\observation-clock-rollback"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$data = "$work\pgdata-$(Get-Date -Format yyyyMMddHHmmss)"
$rollback = "$repo\db\schemas\ROLLBACK_player_prop_observation_clock.sql"
$port = 55434

& "$bin\initdb.exe" -D $data -U postgres -A trust --encoding UTF8 --locale=C | Out-Null
Start-Process -FilePath "$bin\pg_ctl.exe" -ArgumentList @('-D', $data, '-l', "$data.log", '-o', "`"-p $port -c listen_addresses=localhost`"", 'start') -NoNewWindow
for ($i = 0; $i -lt 30; $i++) { & "$bin\pg_isready.exe" -h localhost -p $port -q; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 1 }

function Q([string]$sql) { & "$bin\psql.exe" -h localhost -p $port -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 -c $sql }
function F([string]$file) { & "$bin\psql.exe" -h localhost -p $port -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f $file; if ($LASTEXITCODE -ne 0) { throw "psql failed: $file" } }

$expectedDecision = '499b7eb810b98a50518c9a69f1b3b141'
$expectedEval = '46dae27e91dedba1f75f3daaa92234f5'
$schemaSql = "select (select count(*) from information_schema.columns where column_name in ('observed_at','controller_enqueued_at','provider_updated_at','observation_clock','decision_clock') and table_schema in ('raw','analytics','research') and table_name in ('player_prop_snapshots_v2','player_props_current','prop_decision_lines'))||'|'||(select count(*) from pg_constraint where conname in ('player_prop_snapshots_v2_observation_clock_check','player_props_current_observation_clock_check','prop_decision_lines_decision_clock_check'))||'|'||(select count(*) from information_schema.columns where table_schema='research' and table_name='v_prop_decision_lines' and column_name='decision_clock')"
$md5Sql = "select md5(pg_get_viewdef('research.v_prop_decision_lines'::regclass, true))||' '||md5(pg_get_viewdef('research.v_prop_eval_units'::regclass, true))"
$countSql = "select (select count(*) from research.prop_decision_lines)||' '||(select count(*) from research.v_prop_decision_lines)||' '||(select count(*) from research.v_prop_eval_units)"

try {
  F "$root\stub_schema.sql"
  $rb = Get-Content $rollback -Raw
  $views = $rb.Substring($rb.IndexOf('create view research.v_prop_decision_lines'))
  $views = $views.Substring(0, $views.LastIndexOf('commit;'))
  Set-Content -Path "$work\baseline_views.sql" -Value $views -NoNewline
  F "$work\baseline_views.sql"

  "baseline schema=$(Q $schemaSql) md5=$(Q $md5Sql) counts=$(Q $countSql)"
  if ((Q $md5Sql) -ne "$expectedDecision $expectedEval") { throw 'baseline view defs do not reproduce production' }

  F "$repo\db\schemas\MIGRATION_player_prop_observation_clock.sql"
  "migrated schema=$(Q $schemaSql) counts=$(Q $countSql) view_col15=$(Q "select column_name from information_schema.columns where table_schema='research' and table_name='v_prop_decision_lines' and ordinal_position=15") clocks=$(Q "select string_agg(decision_clock||':'||n, ',') from (select decision_clock, count(*) n from research.v_prop_decision_lines group by 1) s")"

  if ((Q $schemaSql) -ne '9|3|1') { throw 'migration did not produce 9|3|1' }

  F "$repo\db\schemas\MIGRATION_player_prop_observation_clock.sql"
  "rerun schema=$(Q $schemaSql)"

  F $rollback
  "rolled_back schema=$(Q $schemaSql) md5=$(Q $md5Sql) counts=$(Q $countSql)"
  if ((Q $md5Sql) -ne "$expectedDecision $expectedEval" -or (Q $schemaSql) -ne '0|0|0') { throw 'rollback did not restore production view defs' }

  F "$repo\db\schemas\MIGRATION_player_prop_observation_clock.sql"
  Q "insert into raw.player_prop_snapshots_v2 (game_id, observation_clock, observed_at) values (1, 'RESPONSE_RECEIVED', now())" | Out-Null
  $ErrorActionPreference = 'Continue'
  $guard = & "$bin\psql.exe" -h localhost -p $port -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f $rollback 2>&1 | Out-String
  $guardExit = $LASTEXITCODE
  $afterRefusal = Q $schemaSql
  "guard_exit=$guardExit guard_refused=$($guard -match 'rollback refused') schema_after_refusal=$afterRefusal"
  if ($guardExit -eq 0 -or $guard -notmatch 'rollback refused' -or $afterRefusal -ne '9|3|1') { throw 'rollback guard did not refuse' }
  $bad = & "$bin\psql.exe" -h localhost -p $port -U postgres -d postgres -X -At -c "insert into raw.player_prop_snapshots_v2 (game_id, observed_at) values (2, now())" 2>&1 | Out-String
  "null_clock_with_observed_at_rejected=$($bad -match 'observation_clock_check')"
  if ($bad -notmatch 'observation_clock_check') { throw 'NULL clock with observed_at was accepted' }
  'ROLLBACK_VERIFY=PASS'
}
finally {
  & "$bin\pg_ctl.exe" -D $data stop -m fast | Out-Null
  "cluster_stopped data_dir=$data"
}
