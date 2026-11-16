# Court Context — Phase 7L.14: Terraform Drift Prevention

Date: 2026-11-15. Local source and one read-only plan. No Terraform apply, Lambda change, schedule change, or database session.

## A. Executive result

**GO** for the source correction. The production plan against the S3 backend reports no resource changes.

**NO-GO** to apply it. An apply would save a refreshed state object and would not change any resource. This phase does not authorize that write.

## B. Drift inventory

Production state is `court-context-tfstate-260029269390/nba-analytics/infra.tfstate`, last modified `2026-11-09T18:38:20Z`. The plan did not write it. No lock object was present.

| Drift | Where it lives | What an old apply would do |
|---|---|---|
| Nightly package | `lambda/nightly-bdl-updater/.package/dist/index.js` is the 3 November bundle, 1,560,144 bytes, SHA-256 `ec02af72b99bd7ae96ae24956483dc91d3292633bd12fa0cba79ff161c6b6420`. Live CodeSha256 is `mSJRZCHC0OmR4O7kx++30+gF7Y1GslxWcFABHSfmBBA=`. | Replace the certified writer with that older bundle |
| Normalized-storage flag | Absent from Terraform before this change. Present on the live function as `1`. | Remove the flag, because the environment block is the whole map |
| Schedule desired state | `infra/terraform.tfvars` still has `live_ingestion_enabled` and the nightly, odds, injuries, props, status-sync, and scoreboard execution flags set true. State from 9 November still records ten of the twelve schedules as `ENABLED`. Live AWS is `DISABLED` on all twelve. | Enable those ten schedules on the next apply of the old source |
| Props queue mapping | State says enabled. Live mapping is Disabled. | Enable the mapping if the family flag stays true |
| Local `infra/terraform.tfstate` | Zero bytes. Unused while `infra/backend.tf` points at S3. | Not the production workspace |

The other writer Lambdas are `live_api` / `0` / `0`, except `boxscore-scraper`, which is `replay` / `1` / `1`. Those values match the family mode expressions when the execution flags are true. This phase does not change them.

## C. Code preservation

Approach A, pointing Terraform at the certified zip, was not used. That zip lives outside the repo. Copying it into the tree would be a second artifact, and a later build from this branch would still be the wrong package.

Approach B is the change that was made. `aws_lambda_function.nightly_bdl_updater` ignores `filename` and `source_code_hash` only. Environment, runtime, memory, timeout, and the schedules stay managed. `ignore_changes = all` was not used.

Every plan reads `data.aws_lambda_function.nightly_bdl_live` and fails the precondition unless CodeSha256 is exactly `mSJRZCHC0OmR4O7kx++30+gF7Y1GslxWcFABHSfmBBA=`. `scripts/ops/check-nightly-code-sha.mjs` performs the same comparison without Terraform. It printed `match`.

## D. Normalized-storage flag

`PGS_NORMALIZED_STORAGE = "1"` is the last key in the nightly environment merge, after `var.lambda_env`. A tfvars value cannot remove it. The other live keys stay in the merge: the two secrets, the four mode and season keys, and the six `BDL_RATE_LIMIT_*` keys. The plan did not propose an environment change.

## E. Schedule desired state

`local.ingestion_schedule_lock` is `true`. While it stays true, every family schedule state is `DISABLED`, the props and postgame queue mappings are disabled, and the context-prospective rule is `DISABLED`. The family booleans still choose Lambda mode values. They no longer choose schedule state.

| Schedule | Kind | Desired state |
|---|---|---|
| `nba-player-props-0` | Scheduler | DISABLED |
| `nba-player-props-1` | Scheduler | DISABLED |
| `nba-player-props-2` | Scheduler | DISABLED |
| `nba-player-props-near-tip` | Scheduler | DISABLED |
| `nba-player-props-closing` | Scheduler | DISABLED |
| `nba-scoreboard-schedule` | Scheduler | DISABLED |
| `odds-pre-game-snapshot-15m` | Scheduler | DISABLED |
| `nba-game-status-sync-schedule` | Scheduler | DISABLED |
| `boxscore-scraper-daily` | EventBridge | DISABLED |
| `injuries-snapshot-schedule` | EventBridge | DISABLED |
| `nightly-bdl-updater-daily` | EventBridge | DISABLED |
| `projection-ledger-schedule` | EventBridge | DISABLED, already hardcoded |

The tfvars execution flags were left true. Setting them false would also rewrite `injuries-snapshot`, `game-status-sync`, and `scoreboard-collector` from `live_api` to `replay`. That is a Lambda configuration change this phase does not make. The lock is what keeps an unrelated apply from enabling the schedules.

## F. Source diff

Not committed in this file's draft. The commit SHA is recorded after the commit, in the closing note of this audit if the commit succeeds. The intended files are `infra/lambda.tf`, `infra/variables.tf`, `infra/postgame-worker.tf`, `infra/context-prospective-shadow.tf`, `scripts/ops/check-nightly-code-sha.mjs`, and this audit. `terraform.tfvars` is not committed. Unrelated season-boundary edits were not staged.

`terraform fmt` and `terraform validate` succeeded. Validate reported the configuration valid.

## G. Validation

`terraform fmt` on the edited files, then `terraform validate`: success. The code-hash script printed `match`.

## H. Plan

Command, from `infra/`, with the production S3 backend and `terraform.tfvars`:

`terraform plan -lock=false -input=false -detailed-exitcode`

Exit code 0. Terraform printed: "No changes. Your infrastructure matches the configuration."

The refresh included the nightly function, the props queue mapping, and all twelve schedules. No create, update, or destroy was proposed. The state object was still last modified `2026-11-09T18:38:20Z` after the plan, and the lock key was absent.

## I. Remaining risks

- Ignoring `source_code_hash` means a new package in `.package` will not deploy. A future writer release has to use the reviewed code-upload path and then change `nightly_bdl_certified_code_sha256` in the same change.
- The precondition runs on plan and apply. A person who uploads code without planning will not be stopped until the next plan.
- `ingestion_schedule_lock` is a source constant. Deleting it, or setting the family flags and removing the lock, enables schedules again.
- The family flags still set `DATA_MODE=live_api` on injuries, status sync, and the scoreboard. The schedules are disabled, so those functions do not run on a timer. An invoke would still be live.
- Apply of this empty plan would still refresh and save remote state. That is why apply stays unauthorized.
- The November 3 zip remains the rollback artifact. Uploading it makes the next plan fail the hash precondition. It does not restore the retired heap.

## J. Apply request

**NO-GO.** The plan has no resource action. Applying it is a state write, not a correction.

## K. Production changes

None. No apply, no Lambda update, no schedule update, no S3 upload, no database session, no Vercel deploy.
