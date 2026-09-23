import { createHash } from 'node:crypto';
import { catalogProduct } from './ebay-catalog.js';

function fingerprint(item) {
  // Exclude changing countdowns and private seller profile names.
  return createHash('sha256').update(JSON.stringify([
    item.Title, item.SKU, item.QuantityAvailable, item.SellingStatus?.CurrentPrice,
    item.ShippingDetails, item.PictureDetails,
  ])).digest('hex');
}

export async function synchronize(reader, previous, previousState = {}, now = Date.now()) {
  if (previous.seller !== 'gearhubparts' || !Array.isArray(previous.products)) throw new Error('Invalid previous catalog');
  const active = await reader.activeListings();
  const products = new Map(previous.products.map(product => [product.id, product]));
  const state = {};
  const candidates = active.filter(item => Number(item.QuantityAvailable) > 0);
  const priority = item => !products.has(item.ItemID) ? 0 : previousState[item.ItemID]?.fingerprint !== fingerprint(item) ? 1 : 2;
  const queue = candidates.filter(item => priority(item) < 2 || now - (previousState[item.ItemID]?.checkedAt || 0) >= 86400000)
    .sort((a, b) => priority(a) - priority(b) || (previousState[a.ItemID]?.checkedAt || 0) - (previousState[b.ItemID]?.checkedAt || 0))
    .slice(0, 130);
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < queue.length) {
      const item = queue[next++];
      const product = catalogProduct(await reader.itemDetails(item.ItemID));
      products.set(item.ItemID, product);
      state[item.ItemID] = { fingerprint: fingerprint(item), checkedAt: now };
    }
  }));
  // Publish only after a second complete snapshot; failed reads preserve the previous file.
  const current = await reader.activeListings();
  const result = [];
  for (const item of current) {
    const available = Number(item.QuantityAvailable);
    if (!Number.isSafeInteger(available) || available < 0) throw new Error('Invalid availability');
    const product = products.get(item.ItemID);
    if (!available || !product || product.status !== 'In stock') continue;
    const rawPrice = item.SellingStatus?.CurrentPrice;
    const price = Number(rawPrice?.['#text']);
    if (rawPrice?.['@_currencyID'] !== 'USD' || !Number.isFinite(price) || price < 0) throw new Error('Invalid price');
    const shippingDetails = item.ShippingDetails;
    const options = shippingDetails?.ShippingServiceOptions;
    const option = Array.isArray(options) ? options.find(value => value.ShippingService !== 'Pickup') : options;
    const cost = option?.ShippingServiceCost;
    const shipping = shippingDetails?.ShippingType === 'Flat' && option?.ShippingService !== 'Pickup' && cost?.['@_currencyID'] === 'USD' && Number.isFinite(Number(cost['#text'])) && Number(cost['#text']) >= 0 ? Number(cost['#text']) : null;
    result.push({ ...product, title: String(item.Title || product.title), price, shipping });
    state[item.ItemID] ??= previousState[item.ItemID] || { fingerprint: '', checkedAt: 0 };
  }
  const retainedState = Object.fromEntries(result.map(product => [product.id, state[product.id]]));
  return {
    catalog: { seller: 'gearhubparts', updatedAt: new Date(now).toISOString(), products: result },
    state: retainedState,
    detailReads: queue.length,
    deferred: current.filter(item => Number(item.QuantityAvailable) > 0 && !products.has(item.ItemID)).length,
  };
}
