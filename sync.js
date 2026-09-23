import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { createEbayReader } from './lib/ebay-reader.js';
import { synchronize } from './lib/sync.js';
import { writeCatalogFiles } from './lib/catalog-files.js';

try {
  const credentials = {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    refreshToken: process.env.EBAY_REFRESH_TOKEN,
  };
  if (!Object.values(credentials).every(Boolean)) throw new Error('Missing GitHub Secrets');
  const previous = JSON.parse(readFileSync('data/catalog.json', 'utf8'));
  const state = existsSync('data/sync-state.json') ? JSON.parse(readFileSync('data/sync-state.json', 'utf8')) : {};
  const result = await synchronize(createEbayReader({ credentials: () => credentials }), previous, state);
  writeCatalogFiles('data', result.catalog);
  for (const [path, value] of [['data/sync-state.json', result.state]]) {
    writeFileSync(`${path}.tmp`, JSON.stringify(value));
    renameSync(`${path}.tmp`, path);
  }
  console.log(`Published ${result.catalog.products.length} products; ${result.detailReads} detail reads; ${result.deferred} new products deferred. No eBay writes.`);
} catch {
  console.error('Catalog update failed. Previous published catalog retained. Check credentials, API availability and limits.');
  process.exitCode = 1;
}
