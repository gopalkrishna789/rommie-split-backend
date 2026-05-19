import { createSplit, getUnpaidBalanceToSpecificPayer } from '../db/queries/splits.js';

/**
 * Create splits for a new expense.
 *
 * Split modes:
 *  - 'equal'      — divide equally among all members (default)
 *  - 'custom'     — exact paise amounts per member (customShares map)
 *  - 'percentage' — percentage per member (customShares map, values 0-100)
 *  - 'exclude'    — equal split among included members only (customShares: { memberId: true/false })
 *
 * @param {string} expenseId
 * @param {string} payerId
 * @param {number} totalAmount - in paise
 * @param {string[]} memberIds - all member IDs in the room
 * @param {object} [customShares] - depends on splitMode
 * @param {string} [splitMode] - 'equal' | 'custom' | 'percentage' | 'exclude'
 * @returns {Promise<Array>} created split rows
 */
export async function createSplits(expenseId, payerId, totalAmount, memberIds, customShares, splitMode = 'equal') {
  // Resolve effective split mode
  const mode = splitMode || (customShares && Object.keys(customShares).length > 0 ? 'custom' : 'equal');

  // Compute share amounts per member
  const shareMap = computeShares(totalAmount, memberIds, payerId, customShares, mode);

  // Step 1: Fetch all carry-forward values in parallel (skip payer)
  const debtorIds = memberIds.filter(id => id !== payerId && shareMap[id] > 0);
  const carryForwardMap = {};

  await Promise.all(
    debtorIds.map(async (memberId) => {
      carryForwardMap[memberId] = await getUnpaidBalanceToSpecificPayer(memberId, payerId);
    })
  );

  // Step 2: Create all splits in parallel
  const splitPromises = memberIds.map((memberId) => {
    const share = shareMap[memberId] ?? 0;

    if (memberId === payerId) {
      return createSplit({
        expenseId,
        memberId,
        share,
        paid: true,
        paidAt: new Date(),
        carryForward: 0,
      });
    } else if (share === 0) {
      // Excluded member — create a zero-share paid split so they appear in the list
      return createSplit({
        expenseId,
        memberId,
        share: 0,
        paid: true,
        paidAt: new Date(),
        carryForward: 0,
      });
    } else {
      return createSplit({
        expenseId,
        memberId,
        share,
        paid: false,
        paidAt: null,
        carryForward: carryForwardMap[memberId] || 0,
      });
    }
  });

  return Promise.all(splitPromises);
}

/**
 * Compute share amounts for each member based on split mode.
 * Returns { [memberId]: amountPaise }
 */
function computeShares(totalAmount, memberIds, payerId, customShares, mode) {
  const shareMap = {};

  switch (mode) {
    case 'equal': {
      const perShare = Math.round(totalAmount / memberIds.length);
      memberIds.forEach(id => { shareMap[id] = perShare; });
      break;
    }

    case 'custom': {
      // customShares: { [memberId]: amountPaise }
      memberIds.forEach(id => {
        shareMap[id] = customShares?.[id] ?? Math.round(totalAmount / memberIds.length);
      });
      break;
    }

    case 'percentage': {
      // customShares: { [memberId]: percentage (0-100) }
      memberIds.forEach(id => {
        const pct = customShares?.[id] ?? 0;
        shareMap[id] = Math.round((pct / 100) * totalAmount);
      });
      break;
    }

    case 'exclude': {
      // customShares: { [memberId]: true (included) | false (excluded) }
      const includedIds = memberIds.filter(id => customShares?.[id] !== false);
      const perShare = includedIds.length > 0 ? Math.round(totalAmount / includedIds.length) : 0;
      memberIds.forEach(id => {
        shareMap[id] = customShares?.[id] === false ? 0 : perShare;
      });
      break;
    }

    default: {
      const perShare = Math.round(totalAmount / memberIds.length);
      memberIds.forEach(id => { shareMap[id] = perShare; });
    }
  }

  return shareMap;
}

/**
 * Format paise to rupees string for display
 * @param {number} paise
 * @returns {string} e.g. "₹450.00"
 */
export function formatRupees(paise) {
  return `₹${(paise / 100).toFixed(2)}`;
}
