import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "../server/src/models/index.js";
const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password) {
  console.error(
    'Usage: node scripts/create_admin.js "Admin Name" admin@example.com strong-password',
  );
  process.exit(1);
}
await mongoose.connect(process.env.MONGODB_URI);
const exists = await User.findOne({ email });
if (exists) {
  console.error("User already exists");
  process.exit(1);
}
await User.create({
  name,
  email,
  passwordHash: await bcrypt.hash(password, 12),
  role: "admin",
});
console.log("Admin created");
await mongoose.disconnect();
