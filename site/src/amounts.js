// Exact monetary conversion for the 0.001-GEN bounty and stake interface.
export const WEI_PER_UNIT = 10n ** 15n;
export const UNITS_PER_GEN = 1000n;
export const MIN_BOUNTY_UNITS = 1000;
export const MAX_BOUNTY_UNITS = 200000;

export function genToUnits(text) {
  if (typeof text !== 'string' || !/^\d+(\.\d{1,3})?$/.test(text)) {
    throw Error('INVALID_GEN_AMOUNT');
  }
  const [whole, fraction = ''] = text.split('.');
  const units = BigInt(whole) * UNITS_PER_GEN + BigInt(fraction.padEnd(3, '0'));
  if (units < BigInt(MIN_BOUNTY_UNITS) || units > BigInt(MAX_BOUNTY_UNITS)) {
    throw Error('INVALID_GEN_AMOUNT');
  }
  return Number(units);
}

export function unitsToWei(units) {
  if (!Number.isSafeInteger(units) || units < 0) throw Error('INVALID_UNITS');
  return BigInt(units) * WEI_PER_UNIT;
}

export function stakeForUnits(amount) {
  if (!Number.isSafeInteger(amount) || amount < MIN_BOUNTY_UNITS || amount > MAX_BOUNTY_UNITS) {
    throw Error('INVALID_BOUNTY_UNITS');
  }
  return Math.min(10000, Math.max(1000, Math.floor(amount / 10)));
}

export function formatWeiAsGen(value) {
  const wei = BigInt(value);
  if (wei < 0n) throw Error('NEGATIVE_BALANCE');
  const whole = wei / 10n ** 18n;
  const thousandths = (wei % (10n ** 18n)) / WEI_PER_UNIT;
  return `${whole}.${thousandths.toString().padStart(3, '0')}`;
}
