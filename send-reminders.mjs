#!/usr/bin/env node
/**
 * Send reminder emails to all members with pending balances in PRODUCTION
 * This will trigger the backend to send emails to everyone who owes money
 * 
 * Usage: node send-reminders.mjs
 */

const BACKEND_URL = 'https://rommie-split-backend.onrender.com';

console.log('\n📧 Sending reminder emails to members with pending balances...\n');
console.log(`Backend: ${BACKEND_URL}\n`);

async function sendReminders() {
  try {
    // First, get all members to see who has pending balances
    console.log('1️⃣  Fetching members...');
    const membersRes = await fetch(`${BACKEND_URL}/api/admin/members-emails`);
    
    if (!membersRes.ok) {
      console.error(`❌ Failed to fetch members: ${membersRes.status}\n`);
      process.exit(1);
    }

    const membersData = await membersRes.json();
    console.log(`   Found ${membersData.members.length} members\n`);

    // Get all unpaid splits
    console.log('2️⃣  Fetching unpaid splits...');
    const splitsRes = await fetch(`${BACKEND_URL}/api/admin/unpaid-splits`);
    
    if (!splitsRes.ok) {
      console.error(`❌ Failed to fetch splits: ${splitsRes.status}\n`);
      console.error('   Note: You need to add the /api/admin/unpaid-splits endpoint first\n');
      process.exit(1);
    }

    const splitsData = await splitsRes.json();
    console.log(`   Found ${splitsData.splits.length} unpaid splits\n`);

    if (splitsData.splits.length === 0) {
      console.log('✅ No pending balances - everyone is settled up!\n');
      process.exit(0);
    }

    // Group splits by debtor
    const splitsByDebtor = {};
    splitsData.splits.forEach(split => {
      if (!splitsByDebtor[split.member_id]) {
        splitsByDebtor[split.member_id] = [];
      }
      splitsByDebtor[split.member_id].push(split);
    });

    console.log('3️⃣  Sending reminder emails...\n');

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const [memberId, splits] of Object.entries(splitsByDebtor)) {
      const member = membersData.members.find(m => m.id === memberId);
      
      if (!member) {
        console.log(`   ⚠️  Member ${memberId} not found - skipping`);
        skipped++;
        continue;
      }

      if (!member.email) {
        console.log(`   ⚠️  ${member.name} - No email address - skipped`);
        skipped++;
        continue;
      }

      const totalOwed = splits.reduce((sum, s) => sum + s.share + (s.carry_forward || 0), 0);
      
      try {
        // Send reminder via backend API
        const reminderRes = await fetch(`${BACKEND_URL}/api/admin/send-reminder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: 'delete-all-data-2026',
            memberId,
            email: member.email,
            splits,
          }),
        });

        if (reminderRes.ok) {
          console.log(`   ✅ ${member.name} (${member.email}) - ₹${(totalOwed / 100).toFixed(2)}`);
          sent++;
        } else {
          console.log(`   ❌ ${member.name} - Failed: ${reminderRes.status}`);
          failed++;
        }
      } catch (err) {
        console.log(`   ❌ ${member.name} - Error: ${err.message}`);
        failed++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n' + '─'.repeat(60));
    console.log('\n📊 Summary:');
    console.log(`   ✅ Sent: ${sent}`);
    console.log(`   ⚠️  Skipped (no email): ${skipped}`);
    console.log(`   ❌ Failed: ${failed}\n`);

    if (skipped > 0) {
      console.log('💡 Tip: Members without emails need to add them in the app:');
      console.log('   App → Members → Tap profile → Add Email\n');
    }

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error('   Make sure the backend is running on Render\n');
    process.exit(1);
  }
}

await sendReminders();
