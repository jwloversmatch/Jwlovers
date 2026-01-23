// services/ValidationService.js
const validator = require("validator");
const { BaseUser, ROLES } = require("@models/User");

class ValidationService {
  validateRegistrationInput(data) {
    const { email, password, firstName, lastName, userName, dateOfBirth, role } = data;

    if (!email || !password || !firstName || !lastName) {
      return { valid: false, error: "All required fields must be provided" };
    }

    if (!dateOfBirth && (!role || role === ROLES.USER)) {
      return { valid: false, error: "Date of birth is required for dating users" };
    }

    if (!validator.isEmail(email)) {
      return { valid: false, error: "Please provide a valid email address" };
    }

    const passwordStrength = BaseUser.validatePasswordStrength(password);
    if (!passwordStrength.isValid) {
      return { valid: false, error: passwordStrength.errors.join(", ") };
    }

    const minLength = role && role !== ROLES.USER ? 12 : 8;
    if (password.length < minLength) {
      return { valid: false, error: `Password must be at least ${minLength} characters long` };
    }

    if (dateOfBirth && (!role || role === ROLES.USER)) {
      const dobValidation = this.validateDateOfBirth(dateOfBirth);
      if (!dobValidation.valid) {
        return { valid: false, error: dobValidation.error };
      }
    }

    if (role) {
      const validRoles = [ROLES.USER, ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN];
      if (!validRoles.includes(role)) {
        return { valid: false, error: `Invalid role. Must be one of: ${validRoles.join(", ")}` };
      }

      if (role !== ROLES.USER) {
        if (dateOfBirth) {
          const birthDate = new Date(dateOfBirth);
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }

          if (age < 21) {
            return { valid: false, error: "Must be at least 21 years old for staff roles" };
          }
        }

        if (!data.employeeId || !data.department) {
          return { valid: false, error: "Employee ID and department are required for staff registration" };
        }

        if (data.employeeId && !/^[A-Z0-9]+$/.test(data.employeeId)) {
          return { valid: false, error: "Employee ID must contain only uppercase letters and numbers" };
        }
      }
    }

    if (userName) {
      if (userName.length < 3) {
        return { valid: false, error: "Username must be at least 3 characters long" };
      }
      if (userName.length > 20) {
        return { valid: false, error: "Username must be less than 20 characters" };
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(userName)) {
        return { valid: false, error: "Username can only contain letters, numbers, underscores and hyphens" };
      }
    }

    return { valid: true };
  }

  validateDateOfBirth(dateString) {
    try {
      const birthDate = new Date(dateString);
      const today = new Date();

      if (isNaN(birthDate.getTime())) {
        return { valid: false, error: "Please provide a valid date of birth" };
      }

      if (birthDate > today) {
        return { valid: false, error: "Date of birth cannot be in the future" };
      }

      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      const dayDiff = today.getDate() - birthDate.getDate();

      if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
        age--;
      }

      if (age < 18) {
        return { valid: false, error: "You must be at least 18 years old to register" };
      }

      if (age > 100) {
        return { valid: false, error: "You must be under 100 years old to register" };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: "Invalid date format" };
    }
  }
}

module.exports = new ValidationService();