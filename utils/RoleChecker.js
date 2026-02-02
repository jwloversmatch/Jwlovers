// utils/RoleChecker.js
const { ROLES, ROLE_HIERARCHY } = require("@models/User");

class RoleChecker {
  hasMinimumRole(userRole, requiredRole) {
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
    return userLevel >= requiredLevel;
  }

  isRoleAllowed(userRole, allowedRoles = [], options = {}) {
    if (userRole === ROLES.SUPER_ADMIN) {
      return true;
    }
    
    if (allowedRoles.includes(userRole)) {
      return true;
    }
    
    if (options.allowHigherRoles) {
      const userLevel = ROLE_HIERARCHY[userRole] || 0;
      
      let highestAllowedLevel = -1;
      for (const role of allowedRoles) {
        const level = ROLE_HIERARCHY[role] || 0;
        if (level > highestAllowedLevel) {
          highestAllowedLevel = level;
        }
      }
      
      if (userLevel > highestAllowedLevel) {
        return true;
      }
    }
    
    return false;
  }

  isUserTypeAllowed(userType, allowedUserTypes = []) {
    if (!userType) return false;
    
    if (!allowedUserTypes || allowedUserTypes.length === 0) {
      return true;
    }
    
    return allowedUserTypes.includes(userType);
  }
}

module.exports = new RoleChecker();