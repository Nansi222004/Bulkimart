import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const adminSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, default: "Super Admin" },
    email:       { type: String, required: true, unique: true, lowercase: true },
    password:    { type: String, required: true },
    role:        { type: String, enum: ["superAdmin", "admin", "moderator"], default: "admin" },
    permissions: [String], // e.g. ['manage_sellers','manage_orders','view_reports']
    avatar:      String,
    lastLogin:   Date,
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Match admin entered password to hashed password in database
adminSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Encrypt password using bcrypt pre-save hook
adminSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const Admin = mongoose.model("Admin", adminSchema);
export default Admin;
