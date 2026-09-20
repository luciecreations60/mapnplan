import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WEAR_COST_PER_KM,
  buildVehicleExpenseSplit,
  estimatePersonalVehicleCost,
} from '../src/utils/transportCost.js';

const LEG = Object.freeze({
  distanceKm: 170,
  consumptionLPer100Km: 6.5,
  fuelPricePerLiter: 1.85,
  tolls: 0,
});

test('wear is excluded unless the group asked for it', () => {
  const estimate = estimatePersonalVehicleCost({ ...LEG, includeWear: false });

  assert.equal(estimate.wearCost, 0);
  assert.equal(estimate.total, estimate.fuelCost);
});

test('wear is charged per kilometre on top of fuel and tolls', () => {
  const estimate = estimatePersonalVehicleCost({ ...LEG, includeWear: true, wearCostPerKm: 0.1 });

  assert.equal(estimate.wearCost, 17);
  assert.equal(estimate.total, estimate.fuelCost + 17);
});

test('tolls are part of the total and of the cost per kilometre', () => {
  const withTolls = estimatePersonalVehicleCost({ ...LEG, tolls: 23.4, includeWear: false });

  assert.equal(withTolls.tolls, 23.4);
  assert.equal(withTolls.total, withTolls.fuelCost + 23.4);
});

test('the cost per kilometre reflects everything that was included', () => {
  const estimate = estimatePersonalVehicleCost({ ...LEG, includeWear: true, wearCostPerKm: 0.1 });

  assert.equal(estimate.costPerKm, Math.round((estimate.total / 170) * 1000) / 1000);
});

test('a leg with no distance never produces a cost per kilometre', () => {
  const estimate = estimatePersonalVehicleCost({ ...LEG, distanceKm: 0, includeWear: true });

  assert.equal(estimate.costPerKm, 0);
  assert.equal(estimate.wearCost, 0);
});

test('the owner advances the money and is still part of the split', () => {
  const split = buildVehicleExpenseSplit({ ownerId: 'p1', travellerIds: ['p2', 'p3'] });

  assert.equal(split.paidById, 'p1');
  assert.deepEqual(split.splitBetweenIds.sort(), ['p1', 'p2', 'p3']);
});

test('the owner is never counted twice when already listed as a traveller', () => {
  const split = buildVehicleExpenseSplit({ ownerId: 'p1', travellerIds: ['p1', 'p2'] });

  assert.deepEqual(split.splitBetweenIds.sort(), ['p1', 'p2']);
});

test('the default wear rate stays a modest, adjustable estimate', () => {
  assert.ok(DEFAULT_WEAR_COST_PER_KM > 0 && DEFAULT_WEAR_COST_PER_KM < 0.5);
});
