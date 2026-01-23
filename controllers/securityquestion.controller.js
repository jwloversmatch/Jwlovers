// controllers/securityquestion.controller.js - COMPLETE UPDATED VERSION
const SecurityQuestionService = require("@services/securityquestion.service");

// Get a random security question for registration
exports.getQuestion = async (req, res) => {
  try {
    console.log("🔐 GET /security-question called");
    
    const question = await SecurityQuestionService.getRandomQuestion();
    
    if (!question) {
      console.error("❌ No security questions available");
      return res.status(503).json({
        success: false,
        message: "No security questions available. Please try again later.",
        code: "NO_QUESTIONS_AVAILABLE"
      });
    }
    
    const session = await SecurityQuestionService.createRegistrationSession(
      req,
      question.questionId
    );
    
    console.log(`✅ Question sent: ${question.questionId}, Session: ${session.sessionId}`);
    
    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        question: {
          id: question.questionId,
          text: question.questionText,
          category: question.category,
          difficulty: question.difficulty,
          answerType: question.answerType || "exact"
        },
        expiresAt: session.expiresAt,
        expiresIn: 900, // 15 minutes
        maxAttempts: session.maxAttempts || 3,
        instructions: "Submit your answer to /api/auth/validate-answer",
        note: "You have 3 attempts to answer correctly. Answers are case-insensitive."
      },
    });
    
  } catch (error) {
    console.error("❌ Error getting security question:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get security question",
      code: "SERVER_ERROR"
    });
  }
};

// Validate answer and create registration session
exports.validateAnswer = async (req, res) => {
  try {
    console.log("🔐 POST /validate-answer called");
    
    const { sessionId, questionId, answer } = req.body;
    
    // Validate input
    if (!sessionId || !questionId || !answer) {
      console.error("❌ Missing required fields:", { sessionId, questionId, hasAnswer: !!answer });
      return res.status(400).json({
        success: false,
        message: "sessionId, questionId, and answer are required",
        code: "MISSING_FIELDS"
      });
    }
    
    // Trim and clean the answer
    const cleanAnswer = answer.toString().trim();
    if (!cleanAnswer) {
      return res.status(400).json({
        success: false,
        message: "Answer cannot be empty",
        code: "EMPTY_ANSWER"
      });
    }
    
    console.log(`🔍 Validating answer for session: ${sessionId}, question: ${questionId}`);
    
    const validation = await SecurityQuestionService.validateAnswer(
      sessionId,
      questionId,
      cleanAnswer,
      req
    );
    
    if (!validation.success) {
      console.log(`❌ Answer validation failed: ${validation.error} (${validation.code})`);
      
      const response = {
        success: false,
        message: validation.error,
        code: validation.code,
      };
      
      // Add remaining attempts if available
      if (validation.remainingAttempts !== undefined) {
        response.remainingAttempts = validation.remainingAttempts;
        response.message += ` (${validation.remainingAttempts} attempt${validation.remainingAttempts !== 1 ? 's' : ''} remaining)`;
      }
      
      // Add blocked status if available
      if (validation.isBlocked !== undefined) {
        response.isBlocked = validation.isBlocked;
        if (validation.isBlocked) {
          response.message = "Too many incorrect attempts. Please start over with a new question.";
        }
      }
      
      return res.status(400).json(response);
    }
    
    console.log(`✅ Answer correct for session: ${validation.sessionId}`);
    
    const expiresAt = new Date(validation.expiresAt);
    const now = new Date();
    const expiresIn = Math.max(0, Math.floor((expiresAt - now) / 1000));
    
    const responseData = {
      verified: true,
      sessionId: validation.sessionId,
      verifiedAt: validation.verifiedAt,
      expiresAt: validation.expiresAt,
      expiresIn: expiresIn,
      remainingTime: expiresIn > 0 ? 
        `${Math.floor(expiresIn / 60)} minutes ${expiresIn % 60} seconds` : 
        'expired',
      instructions: "Use this sessionId in your registration request at POST /api/auth/register",
      note: "This sessionId can only be used once and expires in 15 minutes"
    };
    
    // Only include token if it exists (it might be removed in the future)
    if (validation.token) {
      responseData.token = validation.token;
      responseData.note += " You can also use the provided token for verification.";
    }
    
    res.json({
      success: true,
      data: responseData,
    });
    
  } catch (error) {
    console.error("🔥 Error validating answer:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate answer",
      code: "VALIDATION_ERROR"
    });
  }
};

// Helper for AuthController to validate session
exports.validateSessionForRegistration = async (sessionId) => {
  try {
    console.log(`🔍 Validating session for registration: ${sessionId}`);
    
    const result = await SecurityQuestionService.validateSessionForRegistration(sessionId);
    
    if (!result.valid) {
      console.log(`❌ Session invalid: ${result.error}`);
    } else {
      console.log(`✅ Session valid: ${sessionId}`);
    }
    
    return result;
    
  } catch (error) {
    console.error("❌ Error validating session:", error);
    return { 
      valid: false, 
      error: "Session validation failed",
      code: "SESSION_VALIDATION_ERROR"
    };
  }
};

// Helper for AuthController to mark session as used
exports.markSessionAsUsed = async (sessionId, userId) => {
  try {
    console.log(`🏷️  Marking session as used: ${sessionId} for user: ${userId}`);
    
    const session = await SecurityQuestionService.markSessionAsUsed(sessionId, userId);
    
    console.log(`✅ Session marked as used: ${sessionId}`);
    
    return session;
    
  } catch (error) {
    console.error("❌ Error marking session as used:", error);
    throw error;
  }
};

// Get session status (for debugging/testing)
exports.getSessionStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "sessionId is required",
        code: "MISSING_SESSION_ID"
      });
    }
    
    const result = await this.validateSessionForRegistration(sessionId);
    
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        message: result.error,
        code: result.code || "INVALID_SESSION"
      });
    }
    
    res.json({
      success: true,
      data: {
        sessionId: result.session.sessionId,
        questionId: result.session.questionId,
        status: result.session.status,
        attempts: result.session.attempts,
        expiresAt: result.session.expiresAt,
        verifiedAt: result.session.verifiedAt,
        userId: result.session.userId,
        remainingTime: Math.floor((new Date(result.session.expiresAt) - new Date()) / 1000),
        timeLeft: new Date(result.session.expiresAt) > new Date() ? 
          `${Math.floor((new Date(result.session.expiresAt) - new Date()) / 60000)} minutes` : 
          'expired'
      }
    });
    
  } catch (error) {
    console.error("❌ Error getting session status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get session status",
      code: "SERVER_ERROR"
    });
  }
};

// Clean up old sessions (admin/cron endpoint)
exports.cleanupSessions = async (req, res) => {
  try {
    console.log("🧹 Cleaning up old sessions...");
    
    const deletedCount = await SecurityQuestionService.cleanupOldSessions();
    
    console.log(`✅ Cleaned up ${deletedCount} old sessions`);
    
    res.json({
      success: true,
      message: `Cleaned up ${deletedCount} old sessions`,
      deletedCount
    });
    
  } catch (error) {
    console.error("❌ Error cleaning up sessions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clean up sessions",
      code: "CLEANUP_ERROR"
    });
  }
};

// Add question (admin endpoint) - NEW
exports.addQuestion = async (req, res) => {
  try {
    const { questionId, questionText, acceptableAnswers, category, difficulty, answerType } = req.body;
    
    if (!questionId || !questionText || !acceptableAnswers || !Array.isArray(acceptableAnswers)) {
      return res.status(400).json({
        success: false,
        message: "questionId, questionText, and acceptableAnswers array are required",
        code: "MISSING_FIELDS"
      });
    }
    
    console.log(`➕ Adding new security question: ${questionId}`);
    
    // Check if question already exists
    const existingQuestion = await require("@models/SecurityQuestion").findOne({ questionId });
    if (existingQuestion) {
      return res.status(409).json({
        success: false,
        message: "Question with this ID already exists",
        code: "DUPLICATE_QUESTION"
      });
    }
    
    // Use the model's create method
    const SecurityQuestion = require("@models/SecurityQuestion");
    const question = await SecurityQuestion.createQuestionWithAnswers({
      questionId,
      questionText,
      acceptableAnswers,
      category: category || "jw_general",
      difficulty: difficulty || "medium",
      answerType: answerType || "exact",
      isActive: true
    });
    
    console.log(`✅ Question added: ${questionId} with ${acceptableAnswers.length} acceptable answers`);
    
    res.json({
      success: true,
      message: "Question added successfully",
      data: {
        questionId: question.questionId,
        questionText: question.questionText,
        category: question.category,
        difficulty: question.difficulty,
        answerType: question.answerType,
        acceptableAnswersCount: acceptableAnswers.length
      }
    });
    
  } catch (error) {
    console.error("❌ Error adding question:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add question",
      code: "ADD_QUESTION_ERROR"
    });
  }
};

// List all questions (admin endpoint) - NEW
exports.listQuestions = async (req, res) => {
  try {
    const { category, difficulty, isActive } = req.query;
    
    const filter = {};
    if (category) filter.category = category;
    if (difficulty) filter.difficulty = difficulty;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    const questions = await require("@models/SecurityQuestion").find(filter)
      .select('questionId questionText category difficulty isActive answerType usageCount')
      .sort('questionId');
    
    res.json({
      success: true,
      data: {
        count: questions.length,
        questions: questions.map(q => ({
          id: q.questionId,
          text: q.questionText,
          category: q.category,
          difficulty: q.difficulty,
          isActive: q.isActive,
          answerType: q.answerType,
          usageCount: q.usageCount
        }))
      }
    });
    
  } catch (error) {
    console.error("❌ Error listing questions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to list questions",
      code: "LIST_QUESTIONS_ERROR"
    });
  }
};

// Toggle question status (admin endpoint) - NEW
exports.toggleQuestionStatus = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { isActive } = req.body;
    
    if (isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: "isActive field is required",
        code: "MISSING_FIELD"
      });
    }
    
    const question = await require("@models/SecurityQuestion").findOneAndUpdate(
      { questionId },
      { isActive },
      { new: true }
    );
    
    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        code: "QUESTION_NOT_FOUND"
      });
    }
    
    console.log(`🔄 Question ${questionId} status updated to: ${isActive ? 'active' : 'inactive'}`);
    
    res.json({
      success: true,
      message: `Question ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        questionId: question.questionId,
        isActive: question.isActive
      }
    });
    
  } catch (error) {
    console.error("❌ Error toggling question status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update question status",
      code: "UPDATE_QUESTION_ERROR"
    });
  }
};