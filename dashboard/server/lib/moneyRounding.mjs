// Existing integer-minor ledger. Preserve raw catalog precision until here.
// New image jobs conservatively round source and converted minor units up.
// Existing video accounting retains its established rounding semantics.
export function sourceReservationMinor(value, capability) {
  return capability === 'generate_image' ? Math.ceil(value) : value
}
export function budgetAmountMinor(value, fxRate, capability) {
  return capability === 'generate_image' && value > 0
    ? Math.ceil(value * fxRate) : Math.round(value * fxRate)
}
