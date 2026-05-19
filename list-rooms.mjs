import mongoose from 'mongoose';

const MONGODB_URI = 'mongodb+srv://vijaykumarveerla3377_db_user:vijay123@cluster0.639d6sb.mongodb.net/?appName=Cluster0';

async function listRooms() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const Room = mongoose.model('Room', new mongoose.Schema({}, { strict: false }));
    
    const rooms = await Room.find({}).limit(10);
    
    console.log(`\nFound ${rooms.length} rooms:\n`);
    
    rooms.forEach((room, index) => {
      console.log(`${index + 1}. Name: ${room.name}`);
      console.log(`   Invite Code: ${room.invite_code}`);
      console.log(`   ID: ${room._id}`);
      console.log('');
    });
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

listRooms();
