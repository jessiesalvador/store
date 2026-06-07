require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const user = await User.findOne({ email: "ai.jessie@outlook.com" });
  console.log("Found:", !!user);
  console.log("Role:", user?.role);
  const ok = await user?.verifyPassword("SuperAdmin#2026");
  console.log("Password match:", ok);
  process.exit(0);
});
