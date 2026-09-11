/**
 * Print Terraform plan resource actions only. No attribute values (avoids secrets).
 * Usage: terraform show -json <plan> | node scripts/ops/summarize-terraform-plan.mjs
 */
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  const plan = JSON.parse(raw);
  const changes = (plan.resource_changes || []).filter((c) =>
    (c.change?.actions || []).some((a) => a !== 'no-op' && a !== 'read')
  );
  for (const c of changes) {
    const actions = (c.change.actions || []).join(',');
    const keys = Object.keys(c.change.after_unknown || {});
    const updateKeys = Object.keys(c.change.after || {})
      .concat(keys)
      .filter((k) => {
        const before = c.change.before?.[k];
        const after = c.change.after?.[k];
        if (k === 'environment' || k === 'variables' || String(k).toLowerCase().includes('secret')) {
          return before !== undefined || after !== undefined || keys.includes(k);
        }
        return JSON.stringify(before) !== JSON.stringify(after) || keys.includes(k);
      });
    const interesting = updateKeys.filter(
      (k) => !['environment', 'tags_all'].includes(k)
    );
    console.log(`${actions}\t${c.address}\t${interesting.slice(0, 12).join(',')}`);
  }
  console.log(`NON_NOOP_COUNT\t${changes.length}`);
  const outputs = Object.entries(plan.output_changes || {}).filter(([, v]) =>
    (v.actions || []).some((a) => a !== 'no-op')
  );
  for (const [name, v] of outputs) {
    console.log(`output\t${(v.actions || []).join(',')}\t${name}`);
  }
});
