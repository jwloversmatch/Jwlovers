module.exports = function (schema) {
  // Find by email (case-insensitive)
  schema.statics.findByEmail = function (email) {
    return this.findOne({ email: email.toLowerCase() });
  };
  
  // Find active users (online in last 5 minutes)
  schema.statics.findActiveUsers = function (options = {}) {
    const query = {
      status: "active",
      lastSeen: { $gt: new Date(Date.now() - 5 * 60 * 1000) },
    };
    
    return this.find(query)
      .select(options.select || "firstName lastName avatar lastSeen")
      .limit(options.limit || 50)
      .skip(options.skip || 0);
  };
  
  // Search users
  schema.statics.search = function (searchTerm, options = {}) {
    const query = {
      $or: [
        { firstName: { $regex: searchTerm, $options: "i" } },
        { lastName: { $regex: searchTerm, $options: "i" } },
        { email: { $regex: searchTerm, $options: "i" } },
      ],
      status: "active",
    };
    
    return this.find(query)
      .select(options.select || "firstName lastName avatar email")
      .limit(options.limit || 20)
      .skip(options.skip || 0);
  };
  
  // Get online count
  schema.statics.getOnlineCount = function () {
    return this.countDocuments({
      status: "active",
      lastSeen: { $gt: new Date(Date.now() - 5 * 60 * 1000) },
    });
  };
};