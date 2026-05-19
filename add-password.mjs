import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const MONGODB_URI = 'mongodb+srv://vijaykumarveerla3377_db_user:vijay123@cluster0.639d6sb.mongodb.net/roomie_split?appName=Cluster0';

async function addPassword() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get the raw collection (bypasses schema validation)
    const db = mongoose.connection.db;
    const membersCollection = db.collection('members');
    
    // Update for Vijay's account
    const email1 = 'vijaykumarveerla3377@gmail.com';
    const password1 = 'vijay123';
    const passwordHash1 = await bcrypt.hash(password1, 10);
    
    const result1 = await membersCollection.updateOne(
      { email: email1 },
      { $set: { password_hash: passwordHash1 } }
    );
    
    console.log('✅ Updated Vijay\'s account');
    console.log('   Matched:', result1.matchedCount);
    console.log('   Modified:', result1.modifiedCount);
    console.log('   Email:', email1);
    console.log('   Password:', password1);
    console.log('');
    
    // Update for Tharun's account
    const email2 = 'raghavakumarisrinu46@gmail.com';
    const password2 = 'tharun123';
    const passwordHash2 = await bcrypt.hash(password2, 10);
    
    const result2 = await membersCollection.updateOne(
      { email: email2 },
      { $set: { password_hash: passwordHash2 } }
    );
    
    console.log('✅ Updated Tharun\'s account');
    console.log('   Matched:', result2.matchedCount);
    console.log('   Modified:', result2.modifiedCount);
    console.log('   Email:', email2);
    console.log('   Password:', password2);
    console.log('');
    
    console.log('✅ All passwords updated successfully!');
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

addPassword();
