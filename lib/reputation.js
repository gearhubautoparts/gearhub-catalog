import { parse } from 'parse5';

const list = value => value ? (Array.isArray(value) ? value : [value]) : [];
const labels = { ItemAsDescribed: 'Accurate description', ShippingAndHandlingCharges: 'Shipping cost', ShippingTime: 'Shipping speed', Communication: 'Communication' };
const count = value => {
  if (value === undefined || value === '') throw new Error('Missing count');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid count');
  return result;
};

export function normalizeReputation(raw, now = Date.now()) {
  const positive = Number(raw.positive);
  if (raw.positive === undefined || !Number.isFinite(positive) || positive < 0 || positive > 100) throw new Error('Invalid percentage');
  const feedbackCount = ['Positive', 'Neutral', 'Negative'].reduce((total, type) => {
    const period = list(raw.summary?.[`${type}FeedbackPeriodArray`]?.FeedbackPeriod).find(item => item.PeriodInDays === '0');
    return total + count(period?.Count);
  }, 0);
  const yearly = list(raw.summary?.SellerRatingSummaryArray?.AverageRatingSummary).find(item => item.FeedbackSummaryPeriod === 'FiftyTwoWeeks');
  const ratings = Object.entries(labels).map(([key, label]) => {
    const entry = list(yearly?.AverageRatingDetails).find(item => item.RatingDetail === key);
    const value = Number(entry?.Rating);
    return [label, entry && Number.isFinite(value) && value >= 1 && value <= 5 ? value.toFixed(1) : null];
  });
  return { seller: 'gearhubparts', updatedAt: new Date(now).toISOString(), positive: `${positive.toFixed(1)}%`, feedbackCount, ratings };
}

// Read only the public store's labelled total, never infer lifetime sales from feedback.
export function parseSoldTotal(html) {
  const document = parse(html);
  const candidates = new Set();
  function visit(node) {
    if (['script', 'style'].includes(node.tagName)) return '';
    const text = node.nodeName === '#text' ? node.value : (node.childNodes || []).map(visit).join('');
    if (node.tagName === 'div') {
      const match = text.trim().match(/^([\d,]+(?:\.\d+)?[KMB]?)\s+items sold$/i);
      if (match) candidates.add(match[1]);
    }
    return text;
  }
  visit(document);
  if (candidates.size !== 1) throw new Error('Public sold total unavailable');
  return [...candidates][0];
}

function displayedSales(value) {
  const match = /^(\d[\d,]*(?:\.\d+)?)([KMB])?$/i.exec(value ?? '');
  if (!match) return NaN;
  const factor = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]?.toUpperCase()] ?? 1;
  return Number(match[1].replaceAll(',', '')) * factor;
}

// Follow the public eBay badge, which can itself be rounded.
export function applySalesMilestone(reputation, displayedTotal, now = Date.now()) {
  const milestone = Math.floor(displayedSales(displayedTotal) / 500) * 500;
  if (!Number.isSafeInteger(milestone) || milestone < 1_000 || milestone <= (displayedSales(reputation.sold) || 0)) {
    return reputation;
  }
  return { ...reputation, sold: `${milestone / 1_000}K`, soldUpdatedAt: new Date(now).toISOString() };
}

export async function refreshReputation(reader, previous = {}, fetchImpl = fetch, now = Date.now()) {
  let result = { ...previous, seller: 'gearhubparts' };
  try { result = { ...result, ...normalizeReputation(await reader.reputation(), now) }; }
  catch { console.warn('Seller ratings unavailable; retaining original check date.'); }
  try {
    const response = await fetchImpl('https://www.ebay.com/str/motorcyclepartstx', { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024) throw new Error('Store page too large');
      chunks.push(chunk);
    }
    result = applySalesMilestone(result, parseSoldTotal(Buffer.concat(chunks).toString('utf8')), now);
  } catch (error) { console.warn(`Public sold total unavailable; retaining published milestone (${error.message}).`); }
  return result;
}
