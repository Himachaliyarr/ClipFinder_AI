import mongoose from 'mongoose';
import { config } from './settings.js';
export async function connectDB(){
  if(!config.mongodbUri) throw new Error('MONGODB_URI is missing');
  await mongoose.connect(config.mongodbUri);
  console.log('MongoDB connected');
}
