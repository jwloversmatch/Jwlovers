module.exports = function (schema) {
  // Full name
  schema.virtual("fullName").get(function () {
    return `${this.firstName} ${this.lastName}`.trim();
  });
  
  // Display name (could be customized)
  schema.virtual("displayName").get(function () {
    return this.fullName;
  });
  
  // Check if user is online
  schema.virtual("isOnline").get(function () {
    if (!this.lastSeen) return false;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return this.lastSeen > fiveMinutesAgo && this.status === "active";
  });
  
  // Profile completion percentage
  schema.virtual("profileCompletion").get(function () {
    let score = 0;
    if (this.firstName?.trim()) score += 25;
    if (this.lastName?.trim()) score += 25;
    if (this.avatar) score += 25;
    if (this.emailVerified) score += 25;
    return score;
  });
  
  // User initials for avatar fallback
  schema.virtual("initials").get(function () {
    return `${this.firstName?.[0] || ""}${this.lastName?.[0] || ""}`.toUpperCase();
  });
};