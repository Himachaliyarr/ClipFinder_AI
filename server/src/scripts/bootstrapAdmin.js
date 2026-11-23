import '../config/env.js';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { User } from '../models/index.js';

const name = process.env.ADMIN_NAME?.trim();
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!name || !email || !password || password.length < 12) {
  throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, and an ADMIN_PASSWORD of at least 12 characters in the root .env');
}

try {
  await connectDB();
  if (await User.countDocuments()) {
    throw new Error('The database already contains users; an existing administrator must manage accounts.');
  }
  await User.create({
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
  });
  console.log('Initial admin account created');
} finally {
  await mongoose.disconnect();
}
