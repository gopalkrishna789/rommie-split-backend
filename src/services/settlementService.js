/**
 * Net Settlement Algorithm
 * 
 * Problem: Person A owes Person B ₹30, Person B owes Person A ₹60
 * Solution: Net it out → Person B pays Person A ₹30 only
 * 
 * This implements a greedy algorithm to minimize the number of transactions.
 */

/**
 * Calculate net balances between all member pairs
 * Returns optimized settlement plan
 * 
 * @param {Array} members - All members in the room
 * @param {Array} unpaidSplits - All unpaid splits
 * @returns {Object} Settlement plan with transactions
 */
export function calculateNetSettlement(members, unpaidSplits) {
  // Step 1: Build a balance matrix (who owes whom)
  const balanceMatrix = {};
  
  // Initialize matrix
  members.forEach(m1 => {
    balanceMatrix[m1.id] = {};
    members.forEach(m2 => {
      if (m1.id !== m2.id) {
        balanceMatrix[m1.id][m2.id] = 0;
      }
    });
  });

  // Fill matrix with unpaid splits
  unpaidSplits.forEach(split => {
    const debtorId = split.member_id;
    const payerId = split.payer_id;
    const amount = split.share + (split.carry_forward || 0);
    
    if (debtorId !== payerId) {
      balanceMatrix[debtorId][payerId] += amount;
    }
  });

  // Step 2: Calculate net balances (offset mutual debts)
  const netBalances = {};
  members.forEach(m => {
    netBalances[m.id] = 0;
  });

  members.forEach(m1 => {
    members.forEach(m2 => {
      if (m1.id < m2.id) { // Process each pair once
        const m1OwesM2 = balanceMatrix[m1.id][m2.id] || 0;
        const m2OwesM1 = balanceMatrix[m2.id][m1.id] || 0;
        
        const netAmount = m1OwesM2 - m2OwesM1;
        
        if (netAmount > 0) {
          // m1 owes m2 (net)
          netBalances[m1.id] -= netAmount;
          netBalances[m2.id] += netAmount;
        } else if (netAmount < 0) {
          // m2 owes m1 (net)
          netBalances[m2.id] -= Math.abs(netAmount);
          netBalances[m1.id] += Math.abs(netAmount);
        }
      }
    });
  });

  // Step 3: Separate creditors (owed money) and debtors (owe money)
  const creditors = [];
  const debtors = [];

  Object.entries(netBalances).forEach(([memberId, balance]) => {
    const member = members.find(m => m.id === memberId);
    if (balance > 0) {
      creditors.push({ ...member, amount: balance });
    } else if (balance < 0) {
      debtors.push({ ...member, amount: Math.abs(balance) });
    }
  });

  // Step 4: Greedy algorithm to minimize transactions
  const transactions = [];
  
  // Sort by amount (largest first) for better optimization
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  let i = 0; // creditor index
  let j = 0; // debtor index

  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i];
    const debtor = debtors[j];

    const settleAmount = Math.min(creditor.amount, debtor.amount);

    if (settleAmount > 0) {
      transactions.push({
        from: debtor.id,
        fromName: debtor.name,
        fromColor: debtor.color,
        fromInitials: debtor.avatar_initials,
        to: creditor.id,
        toName: creditor.name,
        toColor: creditor.color,
        toInitials: creditor.avatar_initials,
        toUpiId: creditor.upi_id,
        toQrCode: creditor.qr_code_base64,
        amount: settleAmount,
      });

      creditor.amount -= settleAmount;
      debtor.amount -= settleAmount;
    }

    if (creditor.amount === 0) i++;
    if (debtor.amount === 0) j++;
  }

  // Step 5: Calculate savings
  const totalTransactionsWithoutNetting = unpaidSplits.length;
  const totalTransactionsWithNetting = transactions.length;
  const transactionsSaved = totalTransactionsWithoutNetting - totalTransactionsWithNetting;

  return {
    transactions,
    summary: {
      totalTransactions: transactions.length,
      totalAmount: transactions.reduce((sum, t) => sum + t.amount, 0),
      transactionsSaved,
      savingsPercentage: totalTransactionsWithoutNetting > 0
        ? Math.round((transactionsSaved / totalTransactionsWithoutNetting) * 100)
        : 0,
    },
  };
}

/**
 * Get detailed breakdown of who owes whom (before netting)
 */
export function getDetailedBalances(members, unpaidSplits) {
  const balances = [];

  members.forEach(debtor => {
    members.forEach(payer => {
      if (debtor.id !== payer.id) {
        const debts = unpaidSplits.filter(
          s => s.member_id === debtor.id && s.payer_id === payer.id
        );

        if (debts.length > 0) {
          const totalOwed = debts.reduce((sum, s) => sum + s.share + (s.carry_forward || 0), 0);
          
          balances.push({
            debtorId: debtor.id,
            debtorName: debtor.name,
            debtorColor: debtor.color,
            payerId: payer.id,
            payerName: payer.name,
            payerColor: payer.color,
            payerUpiId: payer.upi_id,
            amount: totalOwed,
            splitCount: debts.length,
            splits: debts.map(s => ({
              id: s.id,
              purpose: s.purpose,
              amount: s.share + (s.carry_forward || 0),
              date: s.date,
            })),
          });
        }
      }
    });
  });

  return balances;
}
