import mongoose from 'mongoose';

let isConnected = false;

export async function connectMongoDB() {
  if (isConnected) {
    console.log('📦 Using existing MongoDB connection');
    return;
  }

  const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI or DATABASE_URL environment variable is not set');
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      dbName: 'roomie_split',
      minPoolSize: 2,       // Keep at least 2 connections warm — eliminates cold-start latency
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 10000, // Ping Atlas every 10s to keep connections alive
      tls: true,
      tlsAllowInvalidCertificates: false,
      retryWrites: true,
      w: 'majority',
      compressors: ['zlib'], // Compress wire traffic
    });

    isConnected = true;
    console.log('📦 Connected to MongoDB');

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
      isConnected = false;
    });

  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

export async function disconnectMongoDB() {
  if (!isConnected) return;
  
  await mongoose.disconnect();
  isConnected = false;
  console.log('📦 Disconnected from MongoDB');
}

export { mongoose };
