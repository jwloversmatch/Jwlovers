const bcrypt = require("bcryptjs");

module.exports = function (schema) {
  // Hash password before saving
  schema.pre("save", async function (next) {
    try {
      // Only hash if password is modified
      if (!this.isModified("password")) return next();
      
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
      
      // Set password changed timestamp
      if (!this.isNew) {
        this.passwordChangedAt = Date.now() - 1000;
      }
      
      next();
    } catch (error) {
      next(error);
    }
  });
  
  // Update lastActive on save
  schema.pre("save", function (next) {
    if (!this.isNew) {
      this.lastActive = new Date();
    }
    next();
  });
  
  // Handle status changes
  schema.pre("save", function (next) {
    if (this.isModified("status")) {
      if (this.status === "inactive" || this.status === "suspended") {
        this.deactivatedAt = new Date();
      } else if (this.status === "active" && this.deactivatedAt) {
        this.deactivatedAt = null;
      }
    }
    next();
  });
};