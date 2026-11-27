import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Activity, Clip, Podcast, UploadSession, User } from "../models/index.js";
import { allow, auth } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/asyncHandler.js";
import { config } from "../config/settings.js";
const r = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Try again later." },
});
// Keep role and profile data out of tokens; the auth middleware loads the current user.
const issueToken = (user) =>
  jwt.sign({ id: user.id }, config.jwtSecret, { expiresIn: "7d" });
r.post(
  "/register",
  authLimiter,
  wrap(async (req, res) => {
    // Public registration is closed unless an invite secret has explicitly been configured.
    if (!config.inviteCode)
      return res
        .status(403)
        .json({
          error:
            "Registration is disabled. Ask an administrator to create your account.",
        });
    const { name, email, password, inviteCode } = req.body || {};
    if (
      !name?.trim() ||
      !email?.trim() ||
      typeof password !== "string" ||
      password.length < 12
    )
      return res
        .status(400)
        .json({
          error:
            "name, email and a password of at least 12 characters are required",
        });
    if (inviteCode !== config.inviteCode)
      return res.status(403).json({ error: "Invalid invite code" });
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.findOne({ email: normalizedEmail }))
      return res.status(409).json({ error: "Email already registered" });
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role: "editor",
    });
    res
      .status(201)
      .json({
        token: issueToken(user),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
  }),
);
r.post(
  "/login",
  authLimiter,
  wrap(async (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const user = await User.findOne({ email });
    if (
      !user ||
      !(await bcrypt.compare(req.body?.password || "", user.passwordHash))
    )
      return res.status(401).json({ error: "Invalid credentials" });
    res.json({
      token: issueToken(user),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  }),
);
r.get(
  "/me",
  auth,
  wrap(async (req, res) => {
    res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
  }),
);
r.get(
  "/users",
  auth,
  allow("admin"),
  wrap(async (req, res) => {
    const users = await User.find().select("name email role createdAt").sort({ name: 1 }).lean();
    res.json(users);
  }),
);
r.get(
  "/assignable-users",
  auth,
  allow("admin", "editor"),
  wrap(async (req, res) => {
    const users = await User.find({ role: { $in: ["admin", "editor"] } })
      .select("name role")
      .sort({ name: 1 })
      .lean();
    res.json(users);
  }),
);
r.post(
  "/users",
  auth,
  allow("admin"),
  wrap(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;
    const role = req.body?.role || "editor";
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length < 12)
      return res.status(400).json({ error: "Name, valid email and a password of at least 12 characters are required" });
    if (!["admin", "editor", "viewer"].includes(role))
      return res.status(400).json({ error: "Role must be admin, editor or viewer" });
    if (await User.findOne({ email })) return res.status(409).json({ error: "Email already registered" });
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role });
    await Activity.create({ user: req.user.id, action: "user_created", entityType: "User", entityId: user._id, details: { role } });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
  }),
);
r.patch(
  "/users/:id",
  auth,
  allow("admin"),
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid user id" });
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = req.body?.role;
    const password = req.body?.password;
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Name and a valid email are required" });
    if (!["admin", "editor", "viewer"].includes(role))
      return res.status(400).json({ error: "Role must be admin, editor or viewer" });
    if (password !== undefined && password !== "" && (typeof password !== "string" || password.length < 12))
      return res.status(400).json({ error: "A new password must be at least 12 characters" });
    if (String(req.user.id) === req.params.id && role !== "admin")
      return res.status(400).json({ error: "You cannot remove your own admin role" });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (await User.findOne({ email, _id: { $ne: user._id } }))
      return res.status(409).json({ error: "Email already registered" });

    const changedFields = [];
    if (user.name !== name) changedFields.push("name");
    if (user.email !== email) changedFields.push("email");
    if (user.role !== role) changedFields.push("role");
    if (password) changedFields.push("passwordReset");
    user.name = name;
    user.email = email;
    user.role = role;
    if (password) user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();
    await Activity.create({
      user: req.user.id,
      action: "user_updated",
      entityType: "User",
      entityId: user._id,
      details: { changedFields },
    });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  }),
);
r.delete(
  "/users/:id",
  auth,
  allow("admin"),
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ error: "Invalid user id" });
    if (String(req.user.id) === req.params.id)
      return res.status(400).json({ error: "You cannot delete your own account" });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role === "admin") {
      const adminCount = await User.countDocuments({ role: "admin" });
      if (adminCount <= 1)
        return res.status(400).json({ error: "At least one administrator account must remain" });
    }

    const deletedMember = {
      name: user.name,
      email: user.email,
      role: user.role,
    };
    await Clip.updateMany({ assignedTo: user._id }, { $set: { assignedTo: null } });
    await Podcast.updateMany({ createdBy: user._id }, { $unset: { createdBy: "" } });
    await UploadSession.deleteMany({ user: user._id });
    await Activity.create({
      user: req.user.id,
      action: "user_deleted",
      entityType: "User",
      entityId: user._id,
      details: deletedMember,
    });
    await user.deleteOne();

    res.json({
      message: `${deletedMember.name} was deleted`,
      deletedUser: { id: req.params.id, ...deletedMember },
    });
  }),
);
r.patch(
  "/users/:id/role",
  auth,
  allow("admin"),
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid user id" });
    const role = req.body?.role;
    if (!["admin", "editor", "viewer"].includes(role)) return res.status(400).json({ error: "Role must be admin, editor or viewer" });
    if (String(req.user.id) === req.params.id && role !== "admin") return res.status(400).json({ error: "You cannot remove your own admin role" });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const previousRole = user.role;
    user.role = role;
    await user.save();
    await Activity.create({ user: req.user.id, action: "user_role_changed", entityType: "User", entityId: user._id, details: { previousRole, role } });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  }),
);
export default r;
