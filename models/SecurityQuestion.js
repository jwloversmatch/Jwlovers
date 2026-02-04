// models/SecurityQuestion.js - PERFORMANCE OPTIMIZED VERSION
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const securityQuestionSchema = new mongoose.Schema(
  {
    questionId: {
      type: String,
      required: true,
      unique: true,
      index: true, // ✅ ADD INDEX for faster lookups
    },
    questionText: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    hashedAnswers: [{
      type: String,
      required: true,
      select: false,
    }],
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
      index: true, // ✅ ADD INDEX for category filtering
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true, // ✅ ADD INDEX - we query by this often
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

// ✅ ADD COMPOUND INDEX for common query pattern
securityQuestionSchema.index({ isActive: 1, category: 1 });

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
  normalized = normalized.replace(/\s+/g, ' ');
  normalized = normalized.replace(/[.,!?;:'"()\[\]]/g, '');
  
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

// ✅ OPTIMIZED: Static method to validate answer
securityQuestionSchema.statics.validateAnswerById = async function (questionId, userAnswer) {
  try {
    // Use lean() for faster query (returns plain object, not Mongoose doc)
    const question = await this.findOne({ questionId })
      .select('+hashedAnswers')
      .lean();
    
    if (!question) {
      console.error(`Question ${questionId} not found`);
      return false;
    }
    
    if (!question.hashedAnswers || question.hashedAnswers.length === 0) {
      console.error(`Question ${questionId} has no hashed answers`);
      return false;
    }
    
    // Create temp object for normalizeAnswer (since we're using lean())
    const normalizedUserAnswer = this.prototype.normalizeAnswer.call({}, userAnswer);
    
    // Check against all hashed answers
    for (const hashedAnswer of question.hashedAnswers) {
      const isValid = await bcrypt.compare(normalizedUserAnswer, hashedAnswer);
      if (isValid) {
        // ✅ OPTIMIZED: Update usage in background (don't await)
        this.findOneAndUpdate(
          { questionId },
          {
            $inc: { usageCount: 1 },
            $set: { lastUsed: new Date() }
          }
        ).exec().catch(err => console.error("Failed to update usage:", err));
        
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
    console.error("Error creating question:", error);
    throw error;
  }
};

// ✅ HIGHLY OPTIMIZED: Get random question
securityQuestionSchema.statics.getRandomQuestion = async function () {
  try {
    // COUNT active questions (faster than loading all)
    const count = await this.countDocuments({ isActive: true });
    
    if (count === 0) {
      return null;
    }
    
    // ✅ OPTIMIZED: Get random using skip instead of $sample
    // $sample loads ALL documents into memory - very slow!
    const random = Math.floor(Math.random() * count);
    
    const question = await this.findOne({ isActive: true })
      .skip(random)
      .select('questionId questionText category difficulty answerType _id')
      .lean(); // ✅ Use lean() for faster query
    
    // ✅ Update usage in background (don't block response)
    if (question) {
      this.findOneAndUpdate(
        { questionId: question.questionId },
        {
          $inc: { usageCount: 1 },
          $set: { lastUsed: new Date() }
        }
      ).exec().catch(err => console.error("Failed to update usage:", err));
    }
    
    return question;
    
  } catch (error) {
    console.error("Error getting random question:", error);
    return null;
  }
};

// ✅ NEW: Get ALL active questions (for caching)
securityQuestionSchema.statics.getAllActiveQuestions = async function () {
  try {
    const questions = await this.find({ isActive: true })
      .select('+hashedAnswers +acceptableAnswers')
      .lean();
    
    return questions;
  } catch (error) {
    console.error("Error getting all questions:", error);
    return [];
  }
};

// ✅ OPTIMIZED: Add acceptable answer
securityQuestionSchema.methods.addAcceptableAnswer = async function (newAnswer) {
  try {
    const normalizedAnswer = this.normalizeAnswer(newAnswer);
    
    // Check if already exists
    if (this.acceptableAnswers && this.acceptableAnswers.some(
      ans => this.normalizeAnswer(ans) === normalizedAnswer
    )) {
      console.log("Answer already exists");
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
    console.error("Error adding answer:", error);
    throw error;
  }
};

module.exports = mongoose.model("SecurityQuestion", securityQuestionSchema);