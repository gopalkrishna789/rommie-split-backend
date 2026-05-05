import 'dotenv/config';
import { query } from './src/db/index.js';

console.log('\n🔍 Email Configuration Debug\n');

// Check SMTP environment variables
console.log('1. SMTP Configuration:');
console.log('   SMTP_HOST:', process.env.SMTP_HOST || '❌ NOT SET');
console.log('   SMTP_PORT:', process.env.SMTP_PORT || '❌ NOT SET');
console.log('   SMTP_USER:', process.env.SMTP_USER || '❌ NOT SET');
console.log('   SMTP_PASS:', process.env.SMTP_PASS ? '✅ SET' : '❌ NOT SET');
console.log('   SMTP_FROM:', process.env.SMTP_FROM || process.env.SMTP_USER || '❌ NOT SET');

// Check if members have email addresses
console.log('\n2. Members with Email Addresses:');
try {
  const result = await query('SELECT id, name, email, upi_id FROM members');
  const members = result.rows;
  
  if (members.length === 0) {
    console.log('   ⚠️  No members found in database');
  } else {
    console.log(`   Total members: ${members.length}`);
    members.forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.name}`);
      console.log(`      Email: ${m.email || '❌ NO EMAIL'}`);
      console.log(`      UPI: ${m.upi_id}`);
    });
    
    const withEmail = members.filter(m => m.email);
    const withoutEmail = members.filter(m => !m.email);
    
    console.log(`\n   ✅ ${withEmail.length} members have email`);
    console.log(`   ❌ ${withoutEmail.length} members DON'T have email`);
  }
} catch (err) {
  console.error('   Error querying database:', err.message);
}

// Test email sending
console.log('\n3. Testing Email Service:');
try {
  const { sendExpenseAddedEmail } = await import('./src/services/emailService.js');
  
  console.log('   Attempting to send test email...');
  await sendExpenseAddedEmail({
    toEmail: process.env.SMTP_USER, // Send to yourself
    toName: 'Test User',
    payerName: 'Test Payer',
    payerUpiId: '9876543210@paytm',
    purpose: 'Test Expense',
    category: 'groceries',
    totalAmount: 10000,
    yourShare: 5000,
    date: new Date().toISOString().split('T')[0],
    notes: 'This is a test email',
    roomName: 'Test Room',
  });
  
  console.log('   ✅ Test email sent successfully!');
  console.log(`   Check inbox: ${process.env.SMTP_USER}`);
} catch (err) {
  console.error('   ❌ Email sending failed:', err.message);
}

console.log('\n📋 Summary:');
console.log('   If members don\'t have emails, they need to:');
console.log('   1. Go to Members page → Tap their profile');
console.log('   2. Tap "Add Email" button');
console.log('   3. Enter their email address');
console.log('   4. Save');
console.log('\n   OR register new members with email during sign-up\n');

process.exit(0);
