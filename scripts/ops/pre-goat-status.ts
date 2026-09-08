/**
 * Pre-GOAT operator status. Read-only.
 *
 *   npm run ops:pre-goat-status
 */
import 'dotenv/config';
import { buildPreGoatStatus } from '@/lib/ops/pre-goat-status';

const status = buildPreGoatStatus();
for (const line of status.lines) console.log(line);
process.exit(status.overall === 'READY' ? 0 : 1);
