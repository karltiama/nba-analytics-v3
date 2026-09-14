import 'dotenv/config';
import { readOwlsApiKey } from '../../lib/providers/owls-insight/client';

async function main() {
  const key = readOwlsApiKey();
  if (!key) throw new Error('missing key');
  const params = new URLSearchParams({
    eventId: 'nba:Boston Celtics@Toronto Raptors-20240116',
    propType: 'points',
    book: 'draftkings',
    opening: 'true',
    limit: '1',
    offset: '0',
  });
  const url = `https://api.owlsinsight.com/api/v1/history/props?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const text = await res.text();
  console.log(JSON.stringify({ status: res.status, text: text.slice(0, 2000) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
