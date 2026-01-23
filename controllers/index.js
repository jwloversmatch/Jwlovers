// controllers/index.js
const authController = require('./auth/AuthController');
const UserController = require('./profile/UserController');
const SecurityQuestionsController = require('./admin/securityQuestions.controller'); 

const userController = new UserController();

module.exports = {
  // ========== AUTHENTICATION ==========
  register: authController.register.bind(authController),
  registerSecure: authController.registerSecure.bind(authController),
  login: authController.login.bind(authController),
  logout: authController.logout.bind(authController),
  refreshToken: authController.refreshToken.bind(authController),
  
  // ========== PASSWORD MANAGEMENT ==========
  changePassword: authController.changePassword.bind(authController),
  forgotPassword: authController.forgotPassword.bind(authController),
  resetPassword: authController.resetPassword.bind(authController),
  
  // ========== VERIFICATION ==========
  verifyEmail: authController.verifyEmail.bind(authController),
  verifyPhone: authController.verifyPhone.bind(authController),
  resendVerificationEmail: authController.resendVerificationEmail.bind(authController),
  
  // ========== USER MANAGEMENT ==========
  getMe: userController.getMe.bind(userController),
  updatePrivateInfo: userController.updatePrivateInfo.bind(userController),
  updateProfile: userController.updateProfile.bind(userController),
  getSettings: userController.getSettings.bind(userController),
  updateSettings: userController.updateSettings.bind(userController),
  deleteAccount: userController.deleteAccount.bind(userController),
  
  // ========== ADMIN - SECURITY QUESTIONS MANAGEMENT ========== // ✅ ADDED
  getSecurityQuestions: SecurityQuestionsController.getQuestions.bind(SecurityQuestionsController),
  getSecurityQuestionById: SecurityQuestionsController.getQuestionById.bind(SecurityQuestionsController),
  createSecurityQuestion: SecurityQuestionsController.createQuestion.bind(SecurityQuestionsController),
  updateSecurityQuestion: SecurityQuestionsController.updateQuestion.bind(SecurityQuestionsController),
  toggleSecurityQuestionStatus: SecurityQuestionsController.toggleQuestionStatus.bind(SecurityQuestionsController),
  deleteSecurityQuestion: SecurityQuestionsController.deleteQuestion.bind(SecurityQuestionsController),
  getSecurityQuestionStats: SecurityQuestionsController.getQuestionStats.bind(SecurityQuestionsController),
  bulkImportSecurityQuestions: SecurityQuestionsController.bulkImportQuestions.bind(SecurityQuestionsController),
  exportSecurityQuestions: SecurityQuestionsController.exportQuestions.bind(SecurityQuestionsController),
  
  // ========== Optional: Export controllers for testing ==========
  _controllers: {
    auth: authController,
    user: userController,
    securityQuestions: SecurityQuestionsController 
  }
};