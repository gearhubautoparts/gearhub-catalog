import test from 'node:test';
import assert from 'node:assert/strict';
import { synchronize } from './sync.js';

const id = '407020890272';
const amount = number => ({ '#text': String(number), '@_currencyID': 'USD' });
const summary = (overrides = {}) => ({ ItemID: id, Title: 'Part', QuantityAvailable: '1', SellingStatus: { CurrentPrice: amount(80) }, ShippingDetails: { ShippingType: 'Flat', ShippingServiceOptions: { ShippingServiceCost: amount(10) } }, ...overrides });
const detail = item => ({ ...item, Quantity: '1', SellingStatus: { ...item.SellingStatus, ListingStatus: 'Active' }, PictureDetails: { PictureURL: 'https://i.ebayimg.com/images/part.jpg' } });
const previous = { seller: 'gearhubparts', products: [{ id, title: 'Old title', status: 'In stock', price: 75, shipping: 5 }] };
test('refreshes public fields and retains no raw seller information', async () => {
  const item = summary({ PrivateData: 'NEVER PUBLISH' });
  const result = await synchronize({ activeListings: async () => [item], itemDetails: async () => detail(item) }, previous);
  assert.equal(result.catalog.products[0].price, 80);
  assert.equal(result.catalog.products[0].shipping, 10);
  assert.ok(!JSON.stringify(result).includes('NEVER PUBLISH'));
});
test('removes sold products using final snapshot', async () => {
  let calls = 0;
  const result = await synchronize({ activeListings: async () => ++calls === 1 ? [summary()] : [], itemDetails: async () => detail(summary()) }, previous);
  assert.deepEqual(result.catalog.products, []);
});
test('unchanged details are cached; price and availability still checked', async () => {
  const reader = { activeListings: async () => [summary()], itemDetails: async () => detail(summary()) };
  const first = await synchronize(reader, previous, {}, 100000000);
  reader.itemDetails = async () => { throw new Error('Unexpected detail fetch'); };
  const second = await synchronize(reader, first.catalog, first.state, 100000001);
  assert.equal(second.detailReads, 0);
  assert.equal(second.catalog.products.length, 1);
});
test('failed second snapshot aborts without changing previous catalog', async () => {
  let calls = 0;
  const original = JSON.stringify(previous);
  await assert.rejects(synchronize({ activeListings: async () => { if (++calls > 1) throw new Error('API failed'); return [summary()]; }, itemDetails: async () => detail(summary()) }, previous));
  assert.equal(JSON.stringify(previous), original);
});
test('new products are bounded by detail request budget', async () => {
  const items = Array.from({ length: 140 }, (_, index) => summary({ ItemID: String(407020890272 + index) }));
  const result = await synchronize({ activeListings: async () => items, itemDetails: async id => detail(items.find(item => item.ItemID === id)) }, { seller: 'gearhubparts', products: [] });
  assert.equal(result.detailReads, 130);
  assert.equal(result.deferred, 10);
  assert.equal(result.catalog.products.length, 130);
});
test('zero availability and unknown shipping do not look purchasable/free', async () => {
  let calls = 0;
  const result = await synchronize({ activeListings: async () => ++calls === 1 ? [summary()] : [summary({ QuantityAvailable: '0' })], itemDetails: async () => detail(summary()) }, previous);
  assert.equal(result.catalog.products.length, 0);
  const unknown = summary({ ShippingDetails: { ShippingType: 'Calculated' } });
  const calculated = await synchronize({ activeListings: async () => [unknown], itemDetails: async () => detail(unknown) }, previous);
  assert.equal(calculated.catalog.products[0].shipping, null);
});
