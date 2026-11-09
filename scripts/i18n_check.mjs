// Check the i18n dictionaries for missing keys in either language.
// Usage: node scripts/i18n_check.mjs (exit 1 on any gap).
import { STRINGS } from '../site/src/i18n.js';

const en = Object.keys(STRINGS.en);
const zh = Object.keys(STRINGS.zh);
const missingZh = en.filter((k) => !(k in STRINGS.zh));
const missingEn = zh.filter((k) => !(k in STRINGS.en));
if (missingZh.length > 0 || missingEn.length > 0) {
  console.error('missing zh keys:', missingZh);
  console.error('missing en keys:', missingEn);
  process.exit(1);
}
console.log(`i18n OK: ${en.length} keys in en and zh, zero missing.`);
