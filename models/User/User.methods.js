// server/models/User/User.methods.js
module.exports = function(UserSchema) {
  if (!UserSchema || !UserSchema.methods) {
    console.error('❌ UserSchema is undefined or missing methods');
    return;
  }
  
  // Add methods safely
  UserSchema.methods.toJSON = function() {
    const user = this.toObject();
    delete user.password;
    delete user.__v;
    return user;
  };
};