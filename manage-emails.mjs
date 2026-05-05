#!/usr/bin/env node
/**
 * Manage member emails in production database
 * 
 * Usage:
 *   node manage-emails.mjs list                    # List all members
 *   node manage-emails.mjs update <id> <email>     # Update member email
 */

const BACKEND_URL = 'https://rommie-split-backend.onrender.com';
const ADMIN_SECRET = 'delete-all-data-2026'; // Change this if you set a different secret

const [,, command, ...args] = process.argv;

async function listMembers() {
  console.log('\n📧 Fetching members from production...\n');
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/admin/members-emails`);
    
    if (!response.ok) {
      console.error(`❌ Failed: ${response.status} ${response.statusText}\n`);
      process.exit(1);
    }

    const data = await response.json();
    
    if (data.members.length === 0) {
      console.log('❌ No members found in production database\n');
      process.exit(0);
    }

    console.log('┌────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ Name              │ Email                      │ Room Name      │ Status   │');
    console.log('├────────────────────────────────────────────────────────────────────────────┤');

    data.members.forEach(m => {
      const name = (m.name || 'Unknown').padEnd(17).slice(0, 17);
      const email = (m.email || 'NOT SET').padEnd(26).slice(0, 26);
      const room = (m.roomName || 'Unknown').padEnd(14).slice(0, 14);
      const status = m.hasEmail ? '✅ OK    ' : '❌ Missing';
      
      console.log(`│ ${name} │ ${email} │ ${room} │ ${status} │`);
      console.log(`│ ID: ${m.id.padEnd(70)} │`);
      console.log('├────────────────────────────────────────────────────────────────────────────┤');
    });

    console.log('└────────────────────────────────────────────────────────────────────────────┘\n');

    console.log(`Summary:`);
    console.log(`  Total: ${data.summary.total} members`);
    console.log(`  ✅ ${data.summary.withEmail} have email`);
    console.log(`  ❌ ${data.summary.withoutEmail} missing email\n`);

    if (data.summary.withoutEmail > 0) {
      console.log('To update an email:');
      console.log('  node manage-emails.mjs update <member-id> <email>\n');
      console.log('Example:');
      console.log(`  node manage-emails.mjs update ${data.members[0].id} user@example.com\n`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message, '\n');
  }
}

async function updateEmail(memberId, email) {
  if (!memberId || !email) {
    console.error('\n❌ Usage: node manage-emails.mjs update <member-id> <email>\n');
    process.exit(1);
  }

  console.log(`\n📧 Updating email for member ${memberId}...\n`);

  try {
    const response = await fetch(`${BACKEND_URL}/api/admin/update-member-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: ADMIN_SECRET, memberId, email }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ Failed: ${data.error || response.statusText}\n`);
      process.exit(1);
    }

    console.log('✅ Email updated successfully!\n');
    console.log(`   Member: ${data.member.name}`);
    console.log(`   Email:  ${data.member.email}\n`);

  } catch (err) {
    console.error('❌ Error:', err.message, '\n');
  }
}

// Main
if (!command || command === 'list') {
  await listMembers();
} else if (command === 'update') {
  await updateEmail(args[0], args[1]);
} else {
  console.log('\n📧 Manage Production Member Emails\n');
  console.log('Usage:');
  console.log('  node manage-emails.mjs list                    # List all members');
  console.log('  node manage-emails.mjs update <id> <email>     # Update member email\n');
  console.log('Examples:');
  console.log('  node manage-emails.mjs list');
  console.log('  node manage-emails.mjs update abc-123 ganesh@example.com\n');
}
