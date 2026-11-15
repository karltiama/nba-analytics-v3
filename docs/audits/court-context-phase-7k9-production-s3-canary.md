# Court Context Phase 7K.9 — production S3 canary

Temporary route: `POST /api/admin/historical-board-canary`.

This file records the canary before its one production attempt. The removal change replaces this note with the measured result and deletes the route. `HISTORICAL_BOARD_ARCHIVE` stays unset. No board deletion and no VACUUM are part of this change.
