// services/securityQuestion.service.js - COMPLETE WITH SMART VALIDATION
const SecurityQuestion = require("@models/SecurityQuestion");
const SecuritySession = require("@models/SecuritySession");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");

class SecurityQuestionService {
  constructor() {
    this.cache = new Map();
    this.cacheDuration = 5 * 60 * 1000; 
    this.useSmartValidation = true;
  }
  
  // Generate client fingerprint
  generateClientFingerprint(req) {
    const components = [
      req.ip || req.connection.remoteAddress,
      req.headers["user-agent"],
      req.headers["accept-language"],
      req.headers["sec-ch-ua-platform"],
    ].filter(Boolean).join("|");
    
    return crypto
      .createHash("sha256")
      .update(components)
      .digest("hex")
      .substring(0, 32);
  }
  
  // Get random question with caching
  async getRandomQuestion() {
    const cacheKey = "random_question";
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.question;
    }
    
    const question = await SecurityQuestion.getRandomQuestion();
    
    if (question) {
      // Update usage stats (fire and forget)
      SecurityQuestion.findOneAndUpdate(
        { questionId: question.questionId },
        {
          $inc: { usageCount: 1 },
          $set: { lastUsed: new Date() },
        }
      ).exec().catch(err => console.error("Error updating question stats:", err));
      
      this.cache.set(cacheKey, {
        question,
        timestamp: Date.now(),
      });
    }
    
    return question;
  }
  
  // Create registration session
  async createRegistrationSession(req, questionId) {
    const clientFingerprint = this.generateClientFingerprint(req);
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers["user-agent"] || 'unknown';
    
    try {
      const session = new SecuritySession({
        sessionId: uuidv4(),
        questionId,
        ipAddress,
        userAgent,
        usedFor: "registration",
        status: "valid",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        maxAttempts: 3,
        clientFingerprint,
      });
      
      await session.save();
      return session;
    } catch (error) {
      console.error("Error creating registration session:", error);
      throw new Error("Failed to create registration session");
    }
  }
  
  // UPDATED: Validate answer with smart validation support
  async validateAnswer(sessionId, questionId, userAnswer, req) {
    try {
      // Find session WITH select: false fields included
      const session = await SecuritySession.findOne({ sessionId })
        .select('+userAnswerHash +originalAnswer');
      
      if (!session) {
        return {
          success: false,
          error: "Session not found",
          code: "SESSION_NOT_FOUND",
        };
      }
      
      // Check if session matches question
      if (session.questionId !== questionId) {
        return {
          success: false,
          error: "Session does not match question",
          code: "SESSION_MISMATCH",
        };
      }
      
      // Check if session is expired
      if (new Date() > session.expiresAt) {
        session.status = "expired";
        await session.save();
        return {
          success: false,
          error: "Session expired",
          code: "SESSION_EXPIRED",
        };
      }
      
      // Check if session is still valid
      if (session.status !== "valid") {
        return {
          success: false,
          error: `Session is ${session.status}`,
          code: "SESSION_INVALID",
        };
      }
      
      // Check if already used
      if (session.userId) {
        return {
          success: false,
          error: "Session already used for registration",
          code: "SESSION_USED",
        };
      }
      
      // Verify client fingerprint (optional)
      if (session.clientFingerprint) {
        const currentFingerprint = this.generateClientFingerprint(req);
        if (session.clientFingerprint !== currentFingerprint) {
          session.attempts += 1;
          await session.save();
          return {
            success: false,
            error: "Client verification failed",
            code: "CLIENT_MISMATCH",
          };
        }
      }
      
      // UPDATED: Get question WITH hashedAnswers AND acceptableAnswers
      const question = await SecurityQuestion.findOne({ questionId })
        .select('+hashedAnswers +acceptableAnswers');
      
      if (!question) {
        return {
          success: false,
          error: "Question not found",
          code: "QUESTION_NOT_FOUND",
        };
      }
      
      // Check if hashedAnswers exists
      if (!question.hashedAnswers || question.hashedAnswers.length === 0) {
        console.error(`Question ${questionId} has no hashed answers stored`);
        return {
          success: false,
          error: "Question configuration error",
          code: "ANSWER_MISSING",
        };
      }
      
      // Normalize the user's answer using the model's method
      const normalizedUserAnswer = question.normalizeAnswer(userAnswer);
      
      // FIRST: Check against ALL hashed answers (exact matches)
      let isValid = false;
      let matchedHash = false;
      
      for (const hashedAnswer of question.hashedAnswers) {
        const isMatch = await bcrypt.compare(normalizedUserAnswer, hashedAnswer);
        if (isMatch) {
          isValid = true;
          matchedHash = true;
          break;
        }
      }
      
      // SECOND: If no exact hash match, try smart validation (if enabled)
      if (!isValid && this.useSmartValidation && question.acceptableAnswers) {
        try {
          // Try to load AnswerValidationService
          const AnswerValidationService = require('./answerValidation.service');
          const smartValidation = AnswerValidationService.validateJWAnswer(
            userAnswer,
            question.acceptableAnswers
          );
          
          if (smartValidation.valid && smartValidation.score >= 0.7) {
            console.log(`🤖 Smart validation passed (score: ${(smartValidation.score * 100).toFixed(1)}%)`);
            console.log(`   User: "${userAnswer}" matched: "${smartValidation.matched}"`);
            
            // Accept the answer via smart validation
            isValid = true;
            
            // Auto-add this variation to acceptable answers for future use
            try {
              await question.addAcceptableAnswer(userAnswer);
              console.log(`➕ Added new answer variation: "${userAnswer}"`);
            } catch (addError) {
              console.log(`⚠️  Could not add variation: ${addError.message}`);
            }
          }
        } catch (validationError) {
          console.log("⚠️  Smart validation not available, using exact matching only");
        }
      }
      
      if (isValid) {
        // Hash and store the answer in session
        const salt = await bcrypt.genSalt(12);
        session.userAnswerHash = await bcrypt.hash(userAnswer, salt);
        session.originalAnswer = userAnswer;
        session.verifiedAt = new Date();
        session.attempts += 1;
        
        // Update question usage stats
        question.usageCount += 1;
        question.lastUsed = new Date();
        await question.save();
        
        await session.save();
        
        // Generate JWT token for verification (optional)
        const jwt = require("jsonwebtoken");
        const token = jwt.sign(
          {
            sessionId: session.sessionId,
            questionId: question.questionId,
            type: "registration_verification",
          },
          process.env.VERIFICATION_SECRET || "your-verification-secret",
          { expiresIn: "15m" }
        );
        
        const response = {
          success: true,
          sessionId: session.sessionId,
          verifiedAt: session.verifiedAt,
          token: token,
          expiresAt: session.expiresAt,
          remainingAttempts: session.maxAttempts - session.attempts,
        };
        
        // Add smart validation info if applicable
        if (!matchedHash) {
          response.validationType = "smart";
          response.note = "Answer accepted via intelligent matching";
        }
        
        return response;
        
      } else {
        // Increment attempt count
        session.attempts += 1;
        
        // Check if max attempts reached
        if (session.attempts >= session.maxAttempts) {
          session.status = "failed";
          await session.save();
          
          return {
            success: false,
            error: "Too many incorrect attempts",
            code: "MAX_ATTEMPTS_EXCEEDED",
            isBlocked: true,
          };
        }
        
        await session.save();
        
        const remainingAttempts = session.maxAttempts - session.attempts;
        
        const response = {
          success: false,
          error: "Incorrect answer",
          code: "WRONG_ANSWER",
          remainingAttempts,
          isBlocked: false,
        };
        
        // Add similarity hint if smart validation available
        if (this.useSmartValidation && question.acceptableAnswers) {
          try {
            const AnswerValidationService = require('./answerValidation.service');
            const bestMatch = AnswerValidationService.validateJWAnswer(
              userAnswer,
              question.acceptableAnswers
            );
            
            if (bestMatch.score > 0.3) { // If somewhat close
              response.hint = `Close! Best match: ${(bestMatch.score * 100).toFixed(0)}% similar`;
            }
          } catch (hintError) {
            // Ignore hint errors
          }
        }
        
        return response;
      }
      
    } catch (error) {
      console.error("Error validating answer:", error);
      return {
        success: false,
        error: "Validation failed",
        code: "VALIDATION_ERROR",
      };
    }
  }
  
  // UPDATED: Verify session for registration
  async verifySessionForRegistration(sessionId, req) {
    try {
      const session = await SecuritySession.findOne({ sessionId })
        .select('+userAnswerHash +originalAnswer');
      
      if (!session) {
        return {
          success: false,
          error: "Session not found",
          code: "SESSION_NOT_FOUND",
        };
      }
      
      // Check if verified (has answer)
      if (!session.originalAnswer || !session.verifiedAt) {
        return {
          success: false,
          error: "Session not verified",
          code: "SESSION_NOT_VERIFIED",
        };
      }
      
      // Check expiration
      if (new Date() > session.expiresAt) {
        session.status = "expired";
        await session.save();
        return {
          success: false,
          error: "Session expired",
          code: "SESSION_EXPIRED",
        };
      }
      
      // Check if already used
      if (session.userId) {
        return {
          success: false,
          error: "Session already used for registration",
          code: "SESSION_USED",
        };
      }
      
      // Check if session is still valid
      if (session.status !== "valid") {
        return {
          success: false,
          error: `Session is ${session.status}`,
          code: "SESSION_INVALID",
        };
      }
      
      // Verify client fingerprint (optional)
      if (session.clientFingerprint) {
        const currentFingerprint = this.generateClientFingerprint(req);
        if (session.clientFingerprint !== currentFingerprint) {
          return {
            success: false,
            error: "Client verification failed",
            code: "CLIENT_MISMATCH",
          };
        }
      }
      
      // Get question WITH hashedAnswers
      const question = await SecurityQuestion.findOne({ 
        questionId: session.questionId 
      }).select('+hashedAnswers');
      
      if (!question) {
        return {
          success: false,
          error: "Question no longer exists",
          code: "QUESTION_NOT_FOUND",
        };
      }
      
      // Check if hashedAnswers exists
      if (!question.hashedAnswers || question.hashedAnswers.length === 0) {
        return {
          success: false,
          error: "Question configuration error",
          code: "ANSWER_MISSING",
        };
      }
      
      // Validate answer against all hashed answers
      const normalizedSessionAnswer = question.normalizeAnswer(session.originalAnswer);
      let isAnswerValid = false;
      
      for (const hashedAnswer of question.hashedAnswers) {
        const isMatch = await bcrypt.compare(normalizedSessionAnswer, hashedAnswer);
        if (isMatch) {
          isAnswerValid = true;
          break;
        }
      }
      
      // Fallback to smart validation if enabled
      if (!isAnswerValid && this.useSmartValidation) {
        try {
          const AnswerValidationService = require('./answerValidation.service');
          const questionWithAnswers = await SecurityQuestion.findOne({ 
            questionId: session.questionId 
          }).select('+acceptableAnswers');
          
          if (questionWithAnswers && questionWithAnswers.acceptableAnswers) {
            const smartValidation = AnswerValidationService.validateJWAnswer(
              session.originalAnswer,
              questionWithAnswers.acceptableAnswers
            );
            
            if (smartValidation.valid && smartValidation.score >= 0.7) {
              isAnswerValid = true;
              console.log(`🤖 Session verification passed via smart validation`);
            }
          }
        } catch (validationError) {
          // Ignore validation errors in verification
        }
      }
      
      if (!isAnswerValid) {
        session.status = "failed";
        await session.save();
        return {
          success: false,
          error: "Answer validation failed",
          code: "ANSWER_INVALID",
        };
      }
      
      return {
        success: true,
        session: session,
      };
    } catch (error) {
      console.error("Error verifying session:", error);
      return {
        success: false,
        error: "Verification failed",
        code: "VERIFICATION_ERROR",
      };
    }
  }
  
  // Mark session as used (after successful registration)
  async markSessionAsUsed(sessionId, userId) {
    try {
      const session = await SecuritySession.findOne({ sessionId })
        .select('+userAnswerHash +originalAnswer');
      
      if (!session) {
        throw new Error("Session not found");
      }
      
      session.status = "completed";
      session.completedAt = new Date();
      session.userId = userId;
      
      await session.save();
      
      return session;
    } catch (error) {
      console.error("Error marking session as used:", error);
      throw error;
    }
  }
  
  // Validate session for registration
  async validateSessionForRegistration(sessionId) {
    try {
      const session = await SecuritySession.findOne({ sessionId })
        .select('+userAnswerHash +originalAnswer');
      
      if (!session) {
        return { valid: false, error: "Invalid session ID" };
      }
      
      // Check basic validity
      if (session.status !== "valid") {
        return { 
          valid: false, 
          error: `Session is ${session.status}. Please answer a new security question.` 
        };
      }
      
      // Check expiration
      if (new Date() > session.expiresAt) {
        session.status = "expired";
        await session.save();
        return { valid: false, error: "Session has expired. Please answer a new security question." };
      }
      
      // Check if already used
      if (session.userId) {
        return { valid: false, error: "Session has already been used for registration." };
      }
      
      // Check if has a validated answer
      if (!session.userAnswerHash || !session.originalAnswer) {
        return { valid: false, error: "Session not properly verified. Please validate answer first." };
      }
      
      // Get question WITH hashedAnswers
      const question = await SecurityQuestion.findOne({ 
        questionId: session.questionId 
      }).select('+hashedAnswers');
      
      if (!question) {
        return { valid: false, error: "Security question no longer exists." };
      }
      
      // Check if hashedAnswers exists
      if (!question.hashedAnswers || question.hashedAnswers.length === 0) {
        return { valid: false, error: "Security question configuration error." };
      }
      
      // Validate answer against all hashed answers
      const normalizedSessionAnswer = question.normalizeAnswer(session.originalAnswer);
      let isAnswerValid = false;
      
      for (const hashedAnswer of question.hashedAnswers) {
        const isMatch = await bcrypt.compare(normalizedSessionAnswer, hashedAnswer);
        if (isMatch) {
          isAnswerValid = true;
          break;
        }
      }
      
      // Fallback to smart validation
      if (!isAnswerValid && this.useSmartValidation) {
        try {
          const AnswerValidationService = require('./answerValidation.service');
          const questionWithAnswers = await SecurityQuestion.findOne({ 
            questionId: session.questionId 
          }).select('+acceptableAnswers');
          
          if (questionWithAnswers && questionWithAnswers.acceptableAnswers) {
            const smartValidation = AnswerValidationService.validateJWAnswer(
              session.originalAnswer,
              questionWithAnswers.acceptableAnswers
            );
            
            if (smartValidation.valid && smartValidation.score >= 0.7) {
              isAnswerValid = true;
            }
          }
        } catch (validationError) {
          // Ignore validation errors
        }
      }
      
      if (!isAnswerValid) {
        session.status = "failed";
        await session.save();
        return { valid: false, error: "Answer validation failed. Please start over." };
      }
      
      return { valid: true, session };
    } catch (error) {
      console.error("Error validating session:", error);
      return { valid: false, error: "Session validation error." };
    }
  }
  
  // Clean up old sessions (run as cron job)
  async cleanupOldSessions() {
    try {
      const result = await SecuritySession.deleteMany({
        $or: [
          { expiresAt: { $lt: new Date() } },
          { status: "completed", completedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        ]
      });
      return result.deletedCount;
    } catch (error) {
      console.error("Error cleaning up sessions:", error);
      return 0;
    }
  }
  
  // Static method to validate answer for any question
  static async validateQuestionAnswer(questionId, userAnswer) {
    try {
      // Get question WITH hashedAnswers
      const question = await SecurityQuestion.findOne({ questionId })
        .select('+hashedAnswers');
      
      if (!question || !question.hashedAnswers || question.hashedAnswers.length === 0) {
        return false;
      }
      
      // Normalize user answer
      const normalizedUserAnswer = question.normalizeAnswer(userAnswer);
      
      // Validate against all hashed answers
      for (const hashedAnswer of question.hashedAnswers) {
        const isValid = await bcrypt.compare(normalizedUserAnswer, hashedAnswer);
        if (isValid) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error("Error in validateQuestionAnswer:", error);
      return false;
    }
  }
  
  // Toggle smart validation (for testing/admin)
  toggleSmartValidation(enabled) {
    this.useSmartValidation = enabled;
    console.log(`🔄 Smart validation ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  // Clear cache (useful for testing)
  clearCache() {
    this.cache.clear();
  }
  
  // Get cache stats (for debugging)
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([key, value]) => ({
        key,
        age: Date.now() - value.timestamp,
      })),
    };
  }
}

module.exports = new SecurityQuestionService();