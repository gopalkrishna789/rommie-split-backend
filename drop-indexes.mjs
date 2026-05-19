import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;

async function dropIndexes() {
  try {
    await mongoose.connect(MONGODB_URI, {
      dbName: 'roomie_split',
    });

    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    
    // Drop all indexes from all collections
    const collections = ['rooms', 'members', 'expenses', 'splits', 'recurring_expenses', 'activity_logs'];
    
    for (const collectionName of collections) {
      try {
        const collection = db.collection(collectionName);
        await collection.dropIndexes();
        console.log(`✅ Dropped indexes from ${collectionName}`);
      } catch (err) {
        if (err.code === 26) {
          console.log(`⚠️  Collection ${collectionName} doesn't exist yet`);
        } else {
          console.error(`❌ Error dropping indexes from ${collectionName}:`, err.message);
        }
      }
    }

    console.log('\n✅ All indexes dropped successfully');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

dropIndexes();
