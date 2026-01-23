// models/SecurityQuestion.js - UPDATED WITH MULTIPLE ANSWERS
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const securityQuestionSchema = new mongoose.Schema(
  {
    questionId: {
      type: String,
      required: true,
      unique: true,
    },
    questionText: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    // Store multiple hashed answers for variations
    hashedAnswers: [{
      type: String,
      required: true,
      select: false,
    }],
    // Store acceptable answer variations (not hashed, for reference/admin)
    acceptableAnswers: [{
      type: String,
      select: false,
    }],
    category: {
      type: String,
      enum: [
        "governing_body", 
        "jw_history", 
        "doctrine", 
        "dating_principles", 
        "service", 
        "publications", 
        "bethel", 
        "conventions",
        "jw_general"
      ],
      default: "jw_general",
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    lastUsed: {
      type: Date,
    },
    answerType: {
      type: String,
      enum: ["exact", "contains", "synonym", "numeric", "year", "name", "scripture"],
      default: "exact",
    },
  },
  {
    timestamps: true,
  }
);

// Method to get question without sensitive data
securityQuestionSchema.methods.toSafeObject = function() {
  return {
    questionId: this.questionId,
    questionText: this.questionText,
    category: this.category,
    difficulty: this.difficulty,
    isActive: this.isActive,
    _id: this._id,
    answerType: this.answerType
  };
};

// Normalize answer for comparison
securityQuestionSchema.methods.normalizeAnswer = function(answer) {
  let normalized = String(answer).toLowerCase().trim();
  
  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ');
  
  // Remove common punctuation
  normalized = normalized.replace(/[.,!?;:'"()\[\]]/g, '');
  
  // JW-specific normalizations
  const jwReplacements = {
    "jehovahs": "jehovah's",
    "jw": "jehovah's witness",
    "jws": "jehovah's witnesses",
    "wt": "watchtower",
    "gb": "governing body",
    "nwt": "new world translation",
    "brother": "",
    "br": "",
    "sr": "",
    "sister": "",
    "the": "",
  };
  
  Object.entries(jwReplacements).forEach(([key, value]) => {
    const regex = new RegExp(`\\b${key}\\b`, 'gi');
    normalized = normalized.replace(regex, value).trim();
  });
  
  return normalized;
};

// Static method to validate answer against multiple possible answers
securityQuestionSchema.statics.validateAnswerById = async function (questionId, userAnswer) {
  try {
    // Get question WITH hashedAnswers included
    const question = await this.findById(questionId).select('+hashedAnswers');
    
    if (!question) {
      console.error(`Question ${questionId} not found`);
      return false;
    }
    
    if (!question.hashedAnswers || question.hashedAnswers.length === 0) {
      console.error(`Question ${questionId} has no hashed answers stored`);
      return false;
    }
    
    const normalizedUserAnswer = question.normalizeAnswer(userAnswer);
    
    // Check against all hashed answers
    for (const hashedAnswer of question.hashedAnswers) {
      const isValid = await bcrypt.compare(normalizedUserAnswer, hashedAnswer);
      if (isValid) {
        // Update usage stats
        question.usageCount += 1;
        question.lastUsed = new Date();
        await question.save();
        return true;
      }
    }
    
    return false;
    
  } catch (error) {
    console.error("Error validating answer:", error);
    return false;
  }
};

// Static method to create question with multiple answers
securityQuestionSchema.statics.createQuestionWithAnswers = async function (data) {
  try {
    const acceptableAnswers = data.acceptableAnswers || [data.answer];
    const hashedAnswers = [];
    
    // Hash all acceptable answers
    for (const answer of acceptableAnswers) {
      const normalizedAnswer = this.prototype.normalizeAnswer.call({}, answer);
      const saltRounds = 12;
      const hashed = await bcrypt.hash(normalizedAnswer, saltRounds);
      hashedAnswers.push(hashed);
    }
    
    const question = new this({
      questionId: data.questionId,
      questionText: data.questionText,
      hashedAnswers: hashedAnswers,
      acceptableAnswers: acceptableAnswers,
      category: data.category || "jw_general",
      difficulty: data.difficulty || "medium",
      answerType: data.answerType || "exact",
      isActive: data.isActive !== undefined ? data.isActive : true,
    });
    
    return await question.save();
    
  } catch (error) {
    console.error("Error creating question with multiple answers:", error);
    throw error;
  }
};

// Static method to get random question
securityQuestionSchema.statics.getRandomQuestion = async function () {
  const questions = await this.aggregate([
    { $match: { isActive: true } },
    { $sample: { size: 1 } },
    {
      $project: {
        questionId: 1,
        questionText: 1,
        category: 1,
        difficulty: 1,
        _id: 1,
        answerType: 1,
      },
    },
  ]);
  
  return questions[0] || null;
};

// Method to add additional acceptable answers to existing question
securityQuestionSchema.methods.addAcceptableAnswer = async function (newAnswer) {
  try {
    const normalizedAnswer = this.normalizeAnswer(newAnswer);
    
    // Check if already exists in acceptableAnswers
    if (this.acceptableAnswers && this.acceptableAnswers.some(
      ans => this.normalizeAnswer(ans) === normalizedAnswer
    )) {
      console.log("Answer already exists in acceptable answers");
      return this;
    }
    
    // Hash the new answer
    const saltRounds = 12;
    const hashedAnswer = await bcrypt.hash(normalizedAnswer, saltRounds);
    
    // Add to arrays
    this.hashedAnswers.push(hashedAnswer);
    this.acceptableAnswers.push(newAnswer);
    
    await this.save();
    return this;
    
  } catch (error) {
    console.error("Error adding acceptable answer:", error);
    throw error;
  }
};

module.exports = mongoose.model("SecurityQuestion", securityQuestionSchema);