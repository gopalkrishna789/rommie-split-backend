import { createSplit, getUnpaidBalanceForMember } from '../db/queries/splits.js';

/**
 * Create splits for a new expense.
 * - Payer's split is auto-marked paid=true
 * - Each debtor's split includes their current carry-forward (unpaid balance)
 * - Supports 'equal' (default) or 'custom' split modes
 *
 * @param {string} expenseId
 * @param {string} payerId
 * @param {number} totalAmount - in paise
 * @param {string[]} memberIds - all member IDs in the room
 * @param {object} [customShares] - { [memberId]: amountPaise } for custom mode
 * @returns {Promise<Array>} created split rows
 */
export async function createSplits(expenseId, payerId, totalAmount, memberIds, customShares) {
  const isCustom = customShares && Object.keys(customShares).length > 0;
  const perShare = isCustom ? null : Math.round(totalAmount / memberIds.length);
  const splits = [];

  for (const memberId of memberIds) {
    const share = isCustom
      ? (customShares[memberId] || Math.round(totalAmount / memberIds.length))
      : perShare;

    if (memberId === payerId) {
      const split = await createSplit({
        expenseId,
        memberId,
        share,
        paid: true,
        paidAt: new Date(),
        carryForward: 0,
      });
      splits.push(split);
    } else {
      const carryForward = await getUnpaidBalanceForMember(memberId);
      const split = await createSplit({
        expenseId,
        memberId,
        share,
        paid: false,
        paidAt: null,
        carryForward,
      });
      splits.push(split);
    }
  }

  return splits;
}

/**
 * Format paise to rupees string for display
 * @param {number} paise
 * @returns {string} e.g. "₹450.00"
 */
export function formatRupees(paise) {
  return `₹${(paise / 100).toFixed(2)}`;
}
