import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../cleaner.js';

test('normalizeStorage standardizes units and unknown', () => {
  assert.equal(__testables.normalizeStorage('iphone 256 gb sealed'), '256GB');
  assert.equal(__testables.normalizeStorage('macbook 1tb'), '1TB');
  assert.equal(__testables.normalizeStorage('15 Plus 128 eSim Unlocked'), '128GB');
  assert.equal(__testables.normalizeStorage('M5 16/512 Space Black'), '512GB');
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
  assert.equal(__testables.normalizeCondition('good condition'), 'Grade A UK Used');
  assert.equal(__testables.normalizeCondition('condition not stated'), 'Unknown');
  assert.equal(__testables.inferConditionFromRaw('iPhone 14 PM 89 BH', 'Unknown'), 'Grade A UK Used');
  assert.equal(__testables.resolveConditionWithDefaultUsed('iphone 12 pro max 128gb', 'Unknown'), 'Grade A UK Used');
  assert.equal(__testables.resolveConditionWithDefaultUsed('iphone 12 pro max brand new sealed', 'Unknown'), 'Brand New');
});

test('normalizeSim maps expected formats and unknown', () => {
  assert.equal(__testables.normalizeSim('dual sim'), 'Physical SIM');
  assert.equal(__testables.normalizeSim('physical + esim'), 'Physical SIM + ESIM');
  assert.equal(__testables.normalizeSim('esim only'), 'eSIM');
  assert.equal(__testables.normalizeSim('eSIM unlocked'), 'eSIM');
  assert.equal(__testables.normalizeSim('factory unlocked'), 'Physical SIM');
  assert.equal(__testables.normalizeSim('IDM line'), 'Physical SIM');
  assert.equal(__testables.normalizeSim('IDM with eSIM'), 'eSIM');
  assert.equal(__testables.normalizeSim('IDM physical dual'), 'Physical SIM');
  assert.equal(__testables.normalizeSim('IDM physical + eSIM'), 'Physical SIM + ESIM');
  assert.equal(__testables.normalizeSim('locked 16pro'), 'Locked/Wi-Fi Only (ESIM)');
  assert.equal(__testables.normalizeSim('wifi only model'), 'Locked/Wi-Fi Only (ESIM)');
  assert.equal(__testables.normalizeSim('wi-fi only esim'), 'Locked/Wi-Fi Only (ESIM)');
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

test('taxonomy scoring helpers prefer specific entries', () => {
  assert.equal(__testables.taxonomySpecificityScore({ Category: 'Others', Brand: 'Others', Series: 'Others' }), 0);
  assert.equal(__testables.taxonomySpecificityScore({ Category: 'Smartphones', Brand: 'Others', Series: 'Others' }), 1);
  assert.equal(__testables.taxonomySpecificityScore({ Category: 'Smartphones', Brand: 'Samsung', Series: 'S Series' }), 3);
  assert.equal(__testables.isAllOthersTaxonomy({ Category: 'Others', Brand: 'Others', Series: 'Others' }), true);
  assert.equal(__testables.isAllOthersTaxonomy({ Category: 'Others', Brand: 'Samsung', Series: 'Others' }), false);
});

test('toAliasDocId encodes normalized alias', () => {
  assert.equal(__testables.toAliasDocId('  IP 17/PM  '), 'ip%2017%2Fpm');
});

test('inferDeviceTypeFromRaw maps common phone variants', () => {
  assert.equal(__testables.inferDeviceTypeFromRaw('iPhone 14 Pro Max 256GB'), 'iPhone 14 Pro Max');
  assert.equal(__testables.inferDeviceTypeFromRaw('MACBOOK PRO 2019 13'), 'MacBook Pro');
  assert.equal(__testables.inferDeviceTypeFromRaw('17 PM 512GB (P + eSim) Blue'), 'iPhone 17 Pro Max');
  assert.equal(__testables.inferDeviceTypeFromRaw('🇺🇸15 Plus 128 eSim Unlocked'), 'iPhone 15 Plus');
  assert.equal(__testables.inferDeviceTypeFromRaw('14 PROMAX PHYSICAL SIM 256GB MINT'), 'iPhone 14 Pro Max');
  assert.equal(__testables.inferDeviceTypeFromRaw('Brand New Non Active iPhone Air 256GB'), 'iPhone 17 Air');
  assert.equal(__testables.inferDeviceTypeFromRaw('17 Air 256GB (eSim) White'), 'iPhone 17 Air');
  assert.equal(__testables.inferDeviceTypeFromRaw('17 256GB (P + eSim) Black'), 'iPhone 17');
  assert.equal(__testables.inferDeviceTypeFromRaw('Brand new iWatch ultra 3 BLACK non-active'), 'Apple Watch Ultra 3');
});

test('inferTaxonomyFromRaw handles shorthand iphone and airpods lines', () => {
  assert.deepEqual(__testables.inferTaxonomyFromRaw('17 PM 512GB (P + eSim) Blue'), {
    Category: 'Smartphones',
    Brand: 'Apple',
    Series: 'iPhone 17 Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('📷 New Airpod 4 ANC'), {
    Category: 'Sounds',
    Brand: 'Apple',
    Series: 'AirPods Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('iPhone x || 256gb || 100bh || no face'), {
    Category: 'Smartphones',
    Brand: 'Apple',
    Series: 'iPhone X Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('🇺🇸15 Plus 128 eSim Unlocked'), {
    Category: 'Smartphones',
    Brand: 'Apple',
    Series: 'iPhone 15 Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('Brand New Non Active iPhone Air 256GB'), {
    Category: 'Smartphones',
    Brand: 'Apple',
    Series: 'iPhone 17 Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('Brand new iWatch ultra 3 BLACK non-active'), {
    Category: 'Smartwatches',
    Brand: 'Apple',
    Series: 'Apple Watch Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('Uk Used || Samsung Fold 6 || 512gb || Factory Unlocked ||'), {
    Category: 'Smartphones',
    Brand: 'Samsung',
    Series: 'Fold Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('Samsung Z flip6 256GB unlocked'), {
    Category: 'Smartphones',
    Brand: 'Samsung',
    Series: 'Flip Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('S21 ultra256gb'), {
    Category: 'Smartphones',
    Brand: 'Samsung',
    Series: 'S Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('Note 20 ultra 256gb'), {
    Category: 'Smartphones',
    Brand: 'Samsung',
    Series: 'Note Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('B7FS4UA-HP Stream 14-dq6015dx @ N321,000'), {
    Category: 'Laptops',
    Brand: 'Others',
    Series: 'Laptop Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('HP 524SF MONITOR @ N220,000'), {
    Category: 'Accessories',
    Brand: 'Others',
    Series: 'Monitor Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('Wig Ally, Super Double Drawn Vietnamese Bone Straight Wig | 13x4 frontal, 20” | Brand New | ₦420,000'), {
    Category: 'Others',
    Brand: 'Others',
    Series: 'General Listing',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('PLUMBERING | FIXING ALL TOILETS | WITH TILES | ₦10,000'), {
    Category: 'Others',
    Brand: 'Others',
    Series: 'General Listing',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('Non Active Series SE 3rd Gen 40M GPS (7 unit)'), {
    Category: 'Smartwatches',
    Brand: 'Apple',
    Series: 'Apple Watch Series',
  });
  assert.deepEqual(__testables.inferTaxonomyFromRaw('Space Black Nano-Texture Glass'), {
    Category: 'Others',
    Brand: 'Others',
    Series: 'General Listing',
  });
});

test('inferSimByBrandContext applies iPhone and Samsung defaults', () => {
  assert.equal(__testables.inferSimByBrandContext({
    rawProductString: 'iPhone 11 pro max 64GB',
    parsedSim: 'Unknown',
    taxonomy: { Brand: 'Apple', Series: 'iPhone 11 Series' },
    deviceType: 'iPhone 11 Pro Max',
  }), 'Physical SIM');

  assert.equal(__testables.inferSimByBrandContext({
    rawProductString: 'Samsung S24 Ultra dual sim 256GB',
    parsedSim: 'Unknown',
    taxonomy: { Brand: 'Samsung', Series: 'S Series' },
    deviceType: 'Samsung S24 Ultra',
  }), 'Dual SIM');

  assert.equal(__testables.inferSimByBrandContext({
    rawProductString: 'Samsung S24 Ultra 256GB',
    parsedSim: 'Unknown',
    taxonomy: { Brand: 'Samsung', Series: 'S Series' },
    deviceType: 'Samsung S24 Ultra',
  }), 'Single SIM');
});

test('inferDeviceTypeFromRaw resolves Samsung flagship variants', () => {
  assert.equal(__testables.inferDeviceTypeFromRaw('Samsung Z fold6 256GB UNLOCK'), 'Samsung Z Fold6');
  assert.equal(__testables.inferDeviceTypeFromRaw('Uk Used || Samsung Fold 6 || 512gb || Factory Unlocked ||'), 'Samsung Z Fold6');
  assert.equal(__testables.inferDeviceTypeFromRaw('Samsung Z flip6 256GB unlocked'), 'Samsung Z Flip6');
  assert.equal(__testables.inferDeviceTypeFromRaw('Uk Samsung S25 ultra 512GB UNLOCK'), 'Samsung S25 Ultra');
  assert.equal(__testables.inferDeviceTypeFromRaw('S22 ultra128gb'), 'Samsung S22 Ultra');
  assert.equal(__testables.inferDeviceTypeFromRaw('Note 20 ultra 128gb'), 'Samsung Note 20 Ultra');
  assert.equal(__testables.inferDeviceTypeFromRaw('Wig Ally, Super Double Drawn Vietnamese Bone Straight Wig | 13x4 frontal, 20” | Brand New | ₦420,000'), 'Wig Ally');
  assert.equal(__testables.inferDeviceTypeFromRaw('EBA | TWO PLATES | AND MEAT | ₦20,000'), 'EBA');
  assert.equal(__testables.inferDeviceTypeFromRaw('Non Active Series SE 3rd Gen 40M GPS (7 unit)'), 'Apple Watch SE 3');
  assert.equal(__testables.inferDeviceTypeFromRaw('Unknown non-device line', 'Unknown Device'), 'Unknown Device');
});

test('parseStructuredGeneralListing extracts Product | Specs | Condition format', () => {
  assert.deepEqual(__testables.parseStructuredGeneralListing('aaaa | bbbb | cccc'), {
    product: 'aaaa',
    specification: 'bbbb',
    condition: 'cccc',
  });
  assert.equal(__testables.parseStructuredGeneralListing('single segment'), null);
});
