import 'dotenv/config';
import { sendExpenseAddedEmail } from './src/services/emailService.js';

await sendExpenseAddedEmail({
  toEmail:     'prasad.g@station-s.org',
  toName:      'Tharun',
  payerName:   'Gopala Rao',
  payerUpiId:  '9652195634@ybl',
  purpose:     'Groceries',
  category:    'groceries',
  totalAmount: 30000,
  yourShare:   15000,
  date:        new Date().toISOString().split('T')[0],
  notes:       'Monthly groceries split',
  roomName:    'S-Stays PG',
});

console.log('Done! Mail sent to tharun.v@station-s.org');
 