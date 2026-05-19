import mongoose from 'mongoose';

const MONGODB_URI = 'mongodb+srv://vijaykumarveerla3377_db_user:vijay123@cluster0.639d6sb.mongodb.net/roomie_split?appName=Cluster0';

async function markTourComplete() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const membersCollection = db.collection('members');
    
    // Mark tour as completed for all members
    const result = await membersCollection.updateMany(
      {},
      { $set: { tour_completed: true } }
    );
    
    console.log('✅ Marked tour as completed for all members');
    console.log('   Matched:', result.matchedCount);
    console.log('   Modified:', result.modifiedCount);
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

markTourComplete();
