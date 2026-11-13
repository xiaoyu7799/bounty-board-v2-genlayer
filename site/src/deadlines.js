// Display helpers only. The contract enforces transaction-time deadlines.
export function verdictActions(bounty, nowSeconds, isHunter) {
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) throw Error('INVALID_TIME');
  const result = { evaluate: false, challenge: false, resolve: false, execute: false };
  if (bounty.status === 'DELIVERED') result.evaluate = true;
  if (bounty.status !== 'VERDICT_PENDING') return result;
  const deadline = bounty.challenge_deadline;
  if (!Number.isSafeInteger(deadline) || deadline < 0) return result;
  if (bounty.challenge) {
    result.resolve = true;
    return result;
  }
  const expired = nowSeconds >= deadline;
  result.execute = expired;
  result.challenge = Boolean(isHunter && !expired && bounty.challenge_count < 2);
  return result;
}

export function challengeTimeRemaining(bounty, nowSeconds) {
  if (bounty.status !== 'VERDICT_PENDING' || !Number.isSafeInteger(bounty.challenge_deadline)) {
    return null;
  }
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) throw Error('INVALID_TIME');
  return Math.max(0, Math.ceil(bounty.challenge_deadline - nowSeconds));
}
