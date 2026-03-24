import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../cleaner.js';

test('normalizeStorage standardizes units and unknown', () => {
  assert.equal(__testables.normalizeStorage('iphone 256 gb sealed'), '256GB');
  assert.equal(__testables.normalizeStorage('macbook 1tb'), '1TB');
  assert.equal(__testables.normalizeStorage('no storage text'), 'UNKNOWN');
  assert.equal(__testables.normalizeStorage('iphone 15 13128gb'), 'UNKNOWN');
  assert.equal(__testables.normalizeStorage('core i5 8GB RAM 512GB SSD'), '512GB');
});

test('normalizeCondition maps slang and unknown', () => {
  assert.equal(__testables.normalizeCondition('uk used clean'), 'Grade A UK Used');
  assert.equal(__testables.normalizeCondition('brand new sealed'), 'Brand New');
  assert.equal(__testables.normalizeCondition('non active'), 'Brand New');
  assert.equal(__testables.normalizeCondition('mint pristine like new'), 'Grade A UK Used');
  assert.equal(__testables.normalizeCondition('new phone only'), 'Grade A UK Used');
  assert.equal(__testables.normalizeCondition('condition not stated'), 'Unknown');
});

test('normalizeSim maps expected formats and unknown', () => {
  assert.equal(__testables.normalizeSim('dual sim'), 'Dual SIM');
  assert.equal(__testables.normalizeSim('physical + esim'), 'Physical SIM + ESIM');
  assert.equal(__testables.normalizeSim('esim only'), 'eSIM');
  assert.equal(__testables.normalizeSim('eSIM unlocked'), 'eSIM');
  assert.equal(__testables.normalizeSim('factory unlocked'), 'Physical SIM');
  assert.equal(__testables.normalizeSim('single sim physical'), 'Physical SIM');
  assert.equal(__testables.normalizeSim('sim unknown'), 'Unknown');
});

test('variation id is deterministic and lower-kebab', () => {
  const id = __testables.buildVariationId({
    series: 'iPhone 17 Pro Max',
    storage: '256GB',
    condition: 'Brand New',
    sim: 'eSIM',
  });
  assert.equal(id, 'iphone-17-pro-max_256gb_brand-new_esim');
});

test('regexPredictTaxonomy returns Others fallback when no hit', () => {
  const prediction = __testables.regexPredictTaxonomy('unknown xyz', [
    { raw: 'iphone 15 pro', Category: 'Smartphones', Brand: 'Apple', Series: 'iPhone 15 Pro' },
  ]);
  assert.deepEqual(prediction, __testables.canonicalFallbackTaxonomy());
});

test('toAliasDocId encodes normalized alias', () => {
  assert.equal(__testables.toAliasDocId('  IP 17/PM  '), 'ip%2017%2Fpm');
});
