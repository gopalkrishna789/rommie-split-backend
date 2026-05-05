#!/usr/bin/env node
/**
 * Check which members have email addresses in production database
 * Run: node check-emails.mjs
 */

import Database from 'better-sqlite3';

const db = new Database('./roomie.db', { readonly: true });

console.log('\n📧 Checking member email addresses...\n');

const members = db.prepare(`
  SELECT m.id, m.name, m.email, r.name as room_name
  FROM members m
  JOIN rooms r ON m.room_id = r.id
  ORDER BY r.name, m.name
`).all();

if (members.length === 0) {
  console.log('❌ No members found in database\n');
  process.exit(0);
}

let hasEmail = 0;
let noEmail = 0;

console.log('┌─────────────────────────────────────────────────────────┐');
console.log('│ Member Name       │ Email                  │ Status     │');
console.log('├─────────────────────────────────────────────────────────┤');

members.forEach(m => {
  const name = (m.name || 'Unknown').padEnd(17).slice(0, 17);
  const email = (m.email || 'NOT SET').padEnd(22).slice(0, 22);
  const status = m.email ? '✅ Has email' : '❌ Missing';
  
  console.log(`│ ${name} │ ${email} │ ${status} │`);
  
  if (m.email) hasEmail++;
  else noEmail++;
});

console.log('└─────────────────────────────────────────────────────────┘\n');

console.log(`Summary:`);
console.log(`  ✅ ${hasEmail} member(s) have email`);
console.log(`  ❌ ${noEmail} member(s) missing email\n`);

if (noEmail > 0) {
  console.log('⚠️  Members without email will NOT receive notifications!\n');
  console.log('How to fix:');
  console.log('  1. Open app → Members page');
  console.log('  2. Tap your profile');
  console.log('  3. Add email in "Notification Email" section\n');
}

db.close();
