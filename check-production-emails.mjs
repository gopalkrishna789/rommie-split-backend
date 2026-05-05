#!/usr/bin/env node
/**
 * Check member emails in PRODUCTION database via API
 * Run: node check-production-emails.mjs
 */

const BACKEND_URL = 'https://rommie-split-backend.onrender.com';

console.log('\n📧 Checking production member email addresses...\n');
console.log(`Backend: ${BACKEND_URL}\n`);

try {
  // Get database stats (includes member info)
  const response = await fetch(`${BACKEND_URL}/api/admin/database-stats`);
  
  if (!response.ok) {
    console.error('❌ Failed to fetch data from production');
    console.error(`   Status: ${response.status} ${response.statusText}`);
    console.error('\n💡 The admin endpoint might not be accessible.');
    console.error('   You need to check Render logs or database directly.\n');
    process.exit(1);
  }

  const data = await response.json();
  
  console.log('Production Database Stats:');
  console.log(`  Rooms: ${data.rooms || 0}`);
  console.log(`  Members: ${data.members || 0}`);
  console.log(`  Expenses: ${data.expenses || 0}`);
  console.log(`  Splits: ${data.splits || 0}\n`);

  if (data.members === 0) {
    console.log('❌ No members found in production database\n');
    process.exit(0);
  }

  console.log('⚠️  Note: The admin endpoint doesn\'t return individual member details.');
  console.log('   To check emails, you need to:');
  console.log('   1. Check Render logs for email errors');
  console.log('   2. Or connect to production database directly\n');

  console.log('📋 What the logs tell us:');
  console.log('   - Error "queryA EBADNAME" = Members don\'t have valid emails');
  console.log('   - Members need to add emails in their profile\n');

} catch (err) {
  console.error('❌ Error:', err.message);
  console.error('\n💡 Make sure the backend is running on Render\n');
}
