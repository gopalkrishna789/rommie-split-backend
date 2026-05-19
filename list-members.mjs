import mongoose from 'mongoose';

const MONGODB_URI = 'mongodb+srv://vijaykumarveerla3377_db_user:vijay123@cluster0.639d6sb.mongodb.net/roomie_split?appName=Cluster0';

async function listMembers() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const Member = mongoose.model('Member', new mongoose.Schema({}, { strict: false }));
    
    const members = await Member.find({}).limit(10);
    
    console.log(`\nFound ${members.length} members:\n`);
    
    members.forEach((member, index) => {
      console.log(`${index + 1}. Name: ${member.name}`);
      console.log(`   Email: ${member.email || 'No email'}`);
      console.log(`   Has Password: ${member.password_hash ? 'Yes' : 'No'}`);
      console.log(`   All fields:`, Object.keys(member.toObject()));
      console.log('');
    });
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

listMembers();
