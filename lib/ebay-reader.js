import { XMLParser, XMLValidator } from 'fast-xml-parser';

const scope = 'https://api.ebay.com/oauth/api_scope';
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true, processEntities: true });
async function responseText(response, limit) {
  if (!response.ok) throw new Error(`eBay request failed (HTTP ${response.status}).`);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('eBay response exceeded the safety limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Only fixed, read-only Trading operations are exposed. No caller-supplied API URL or XML.
export function createEbayReader({ credentials, fetchImpl = fetch, now = Date.now }) {
  let accessToken = '';
  let expiresAt = 0;
  let pendingToken;
  async function token() {
    if (accessToken && expiresAt > now() + 60000) return accessToken;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
      const saved = credentials();
      if (!saved?.clientSecret || !saved.refreshToken) throw new Error('Save credentials and authorize the seller account first.');
      try {
        const response = await fetchImpl('https://api.ebay.com/identity/v1/oauth2/token', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${saved.clientId}:${saved.clientSecret}`).toString('base64')}` },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refreshToken, scope }).toString(),
        });
        const result = JSON.parse(await responseText(response, 65536));
        if (typeof result.access_token !== 'string' || !result.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 60) throw new Error();
        accessToken = result.access_token; expiresAt = now() + result.expires_in * 1000;
        return accessToken;
      } catch { throw new Error('eBay authorization failed. Check the new keyset and seller authorization.'); }
    })();
    try { return await pendingToken; } finally { pendingToken = null; }
  }
  async function readCall(name, body) {
    const access = await token();
    try {
      const response = await fetchImpl('https://api.ebay.com/ws/api.dll', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'X-EBAY-API-CALL-NAME': name, 'X-EBAY-API-COMPATIBILITY-LEVEL': '1477', 'X-EBAY-API-SITEID': '0', 'X-EBAY-API-IAF-TOKEN': access },
        body: `<?xml version="1.0" encoding="utf-8"?><${name}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${name}Request>`,
      });
      const xml = await responseText(response, 2 * 1024 * 1024);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error();
      const result = parser.parse(xml)[`${name}Response`];
      if (result?.Ack !== 'Success') throw new Error();
      return result;
    } catch { throw new Error('eBay read failed or returned incomplete data. No catalog changes were made.'); }
  }
  return {
    async activeListings() {
      const identity = await readCall('GetUser', '<DetailLevel>ReturnSummary</DetailLevel>');
      if (identity.User?.UserID?.toLowerCase() !== 'gearhubparts') throw new Error('Unexpected seller. No import performed.');
      const items = new Map();
      let expected;
      for (let page = 1; page <= 100; page++) {
        const result = await readCall('GetMyeBaySelling', `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><SoldList><Include>false</Include></SoldList><UnsoldList><Include>false</Include></UnsoldList><ScheduledList><Include>false</Include></ScheduledList>`);
        const total = Number(result.ActiveList?.PaginationResult?.TotalNumberOfEntries);
        if (!Number.isSafeInteger(total) || total < 0 || (expected !== undefined && expected !== total)) throw new Error('Listing count changed during import. Retry without publishing.');
        expected = total;
        const raw = result.ActiveList?.ItemArray?.Item;
        const batch = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
        for (const item of batch) {
          if (!/^\d+$/.test(item.ItemID) || items.has(item.ItemID)) throw new Error('Invalid or duplicate listing in snapshot.');
          items.set(item.ItemID, item);
        }
        if (items.size === total) return [...items.values()];
        if (!batch.length || items.size > total) break;
      }
      throw new Error('Incomplete listing snapshot. No import performed.');
    },
    async itemDetails(id) {
      if (typeof id !== 'string' || !/^\d{9,15}$/.test(id)) throw new Error('Invalid listing ID.');
      const result = await readCall('GetItem', `<ItemID>${id}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics>`);
      if (result.Item?.ItemID !== id || result.Item?.Seller?.UserID?.toLowerCase() !== 'gearhubparts') throw new Error('Unexpected listing identity.');
      return result.Item;
    },
    async preview() {
      const identity = await readCall('GetUser', '<DetailLevel>ReturnSummary</DetailLevel>');
      const seller = identity.User?.UserID;
      if (typeof seller !== 'string' || seller.toLowerCase() !== 'gearhubparts') throw new Error('The authorized seller does not match gearhubparts. No import performed.');
      const result = await readCall('GetMyeBaySelling', '<ActiveList><Include>true</Include><Pagination><EntriesPerPage>10</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList><SoldList><Include>false</Include></SoldList><UnsoldList><Include>false</Include></UnsoldList><ScheduledList><Include>false</Include></ScheduledList>');
      const total = Number(result.ActiveList?.PaginationResult?.TotalNumberOfEntries);
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('eBay did not return a complete listing count.');
      const raw = result.ActiveList?.ItemArray?.Item;
      const items = raw ? (Array.isArray(raw) ? raw : [raw]).map(item => ({ id: String(item.ItemID || ''), sku: String(item.SKU || ''), title: String(item.Title || '') })) : [];
      if (total > 0 && !items.length) throw new Error('eBay returned an incomplete preview.');
      return { seller, total, items, previewOnly: true, checkedAt: new Date(now()).toISOString() };
    },
  };
}
