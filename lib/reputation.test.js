import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReputation, parseSoldTotal, refreshReputation } from './reputation.js';

test('public lifetime sales parsed from labelled HTML, not a script or feedback count', () => {
  assert.equal(parseSoldTotal('<div><span>820</span><!--x--> items sold</div>'), '820');
  assert.equal(parseSoldTotal('<div><span>1.2K</span> items sold</div>'), '1.2K');
  assert.throws(() => parseSoldTotal('<div>Confirm you are human</div>'));
  assert.throws(() => parseSoldTotal('<div>820 items sold</div><div>900 items sold</div>'));
});
test('seller feedback total includes all signs; missing ratings are not zeros', () => {
  const summary = Object.fromEntries(['Positive','Neutral','Negative'].map((type, i) => [`${type}FeedbackPeriodArray`, { FeedbackPeriod: [{ PeriodInDays: '0', Count: String(10 + i) }] }]));
  const result = normalizeReputation({ positive: '99.8', summary }, 0);
  assert.equal(result.feedbackCount, 33);
  assert.equal(result.positive, '99.8%');
  assert.ok(result.ratings.every(([, value]) => value === null));
  assert.throws(() => normalizeReputation({ positive: '99.8', summary: {} }));
});
test('failures retain last known values and their timestamps', async () => {
  const previous = { seller: 'gearhubparts', positive: '99.8%', updatedAt: 'old', sold: '820', soldUpdatedAt: 'older' };
  assert.deepEqual(await refreshReputation({ reputation: async () => { throw new Error(); } }, previous, async () => new Response('Blocked', { status: 403 })), previous);
});
