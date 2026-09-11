/**
 * models/user.model.js — User Schema (Placeholder)
 *
 * Skeleton is ready. Fields will be finalized once auth flow is shared.
 * Includes password hashing hook and common instance methods.
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: [true, "Name is required"],
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [50, "Name cannot exceed 50 characters"],
    },
    // Primary login identifier — unique, lowercase
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // Never returned in queries by default
    },
    roleType: {
      type: String,
      enum: {
        values: ["SuperAdmin", "Operator"],
        message: "Role must be one of: SuperAdmin, Operator",
      },
      default: "Operator",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    profilePic: {
      type: String,
      default: null,
    },
    passwordChangedAt: Date,
    resetPasswordOtp: String,
    otpExpires: Date,
    refreshToken: {
      type: String,
      select: false,
    },
    loginAttempts: {
      type: Number,
      required: true,
      default: 0
    },
    lockUntil: {
      type: Number
    },
    lastLogin: Date,
    preferences: {
      themeMode: { type: String, enum: ['light', 'dark'], default: 'light' },
      showDashboardClock: { type: Boolean, default: true },
      shortcuts: [{ type: String }]
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

userSchema.index({ roleType: 1 });

// ── Pre-save: Hash password ───────────────────────────────────────────────────
userSchema.pre("save", async function (next) {
  // Only hash if password was modified
  if (!this.isModified("password")) return next();

  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);

  // Update passwordChangedAt (except on initial save)
  if (!this.isNew) {
    this.passwordChangedAt = Date.now() - 1000; // 1s buffer for JWT timing
  }
  next();
});

// ── Instance method: Compare passwords ───────────────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ── Instance method: Check if password changed after token issued ─────────────
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// ── Virtual: full name (extend as needed) ────────────────────────────────────
userSchema.virtual("initials").get(function () {
  return this.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
});

// Virtual for checking if account is currently locked
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

const User = mongoose.model("User", userSchema);

module.exports = User;
