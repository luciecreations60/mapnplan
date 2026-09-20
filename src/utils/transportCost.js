const VEHICLE_BASE_CONSUMPTION = Object.freeze({
  city: 5.8,
  compact: 6.5,
  sedan: 7.2,
  suv: 8.8,
  van: 10.2,
});

const FUEL_FACTORS = Object.freeze({
  petrol: 1,
  diesel: 0.9,
  hybrid: 0.72,
});

export function getSuggestedConsumption(vehicleType = 'compact', fuelType = 'petrol') {
  const base = VEHICLE_BASE_CONSUMPTION[vehicleType] ?? VEHICLE_BASE_CONSUMPTION.compact;
  const factor = FUEL_FACTORS[fuelType] ?? 1;
  return Math.round(base * factor * 10) / 10;
}

export function estimateDrivingCost({ distanceKm, consumptionLPer100Km, fuelPricePerLiter, tolls = 0 }) {
  const distance = Math.max(0, Number(distanceKm) || 0);
  const consumption = Math.max(0, Number(consumptionLPer100Km) || 0);
  const fuelPrice = Math.max(0, Number(fuelPricePerLiter) || 0);
  const tollAmount = Math.max(0, Number(tolls) || 0);
  const fuelLiters = (distance / 100) * consumption;
  const fuelCost = fuelLiters * fuelPrice;
  return {
    distanceKm: Math.round(distance * 10) / 10,
    fuelLiters: Math.round(fuelLiters * 10) / 10,
    fuelCost: Math.round(fuelCost * 100) / 100,
    tolls: Math.round(tollAmount * 100) / 100,
    total: Math.round((fuelCost + tollAmount) * 100) / 100,
  };
}

/**
 * Wear cost of using a personal car, per kilometre.
 *
 * Deliberately a plain adjustable rate rather than a built-in formula. The
 * French tax mileage scale is the usual reference, but it changes every year
 * and already includes fuel — hard-coding it would produce a stale figure and
 * double-count the fuel this module computes separately.
 */
export const DEFAULT_WEAR_COST_PER_KM = 0.1;

/**
 * Full cost of a leg driven in a personal vehicle: fuel, tolls and, when the
 * group agreed to it, wear. Wear is returned separately as well, so the
 * interface can always show what it represents instead of hiding it inside a
 * single total.
 */
export function estimatePersonalVehicleCost({
  distanceKm,
  consumptionLPer100Km,
  fuelPricePerLiter,
  tolls = 0,
  wearCostPerKm = DEFAULT_WEAR_COST_PER_KM,
  includeWear = false,
}) {
  const base = estimateDrivingCost({ distanceKm, consumptionLPer100Km, fuelPricePerLiter, tolls });
  const wearRate = Math.max(0, Number(wearCostPerKm) || 0);
  const wearCost = includeWear ? Math.round(base.distanceKm * wearRate * 100) / 100 : 0;

  return {
    ...base,
    wearCostPerKm: wearRate,
    wearCost,
    includeWear: Boolean(includeWear),
    total: Math.round((base.total + wearCost) * 100) / 100,
    costPerKm: base.distanceKm > 0
      ? Math.round(((base.total + wearCost) / base.distanceKm) * 1000) / 1000
      : 0,
  };
}

/**
 * Turns a leg into a shared expense: the vehicle owner advanced the money, and
 * the cost is split between every traveller — the owner included, since they
 * travel too. The owner therefore ends up owed the others' shares rather than
 * the whole amount.
 */
export function buildVehicleExpenseSplit({ ownerId, travellerIds = [] }) {
  const splitBetweenIds = [...new Set(travellerIds.map(String).filter(Boolean))];
  if (ownerId && !splitBetweenIds.includes(String(ownerId))) splitBetweenIds.push(String(ownerId));
  return { paidById: ownerId ? String(ownerId) : '', splitBetweenIds };
}
