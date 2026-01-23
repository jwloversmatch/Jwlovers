// controllers/admin/securityQuestions.controller.js
const SecurityQuestion = require('@models/SecurityQuestion');
const SecuritySession = require('@models/SecuritySession');

class SecurityQuestionsController {
  // ========== SECURITY QUESTIONS MANAGEMENT ==========
  
  // Get all security questions with pagination and filters
  async getQuestions(req, res) {
    try {
      const { 
        category, 
        difficulty, 
        isActive, 
        search,
        page = 1, 
        limit = 20 
      } = req.query;
      
      // Build filter
      const filter = {};
      
      if (category) filter.category = category;
      if (difficulty) filter.difficulty = difficulty;
      if (isActive !== undefined) filter.isActive = isActive === 'true';
      
      // Search in question text
      if (search) {
        filter.questionText = { $regex: search, $options: 'i' };
      }
      
      // Execute query with pagination
      const questions = await SecurityQuestion.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .select('-hashedAnswer -salt'); // Exclude sensitive data
      
      const total = await SecurityQuestion.countDocuments(filter);
      
      res.json({
        success: true,
        data: questions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch security questions'
      });
    }
  }
  
  // Get single question by ID
  async getQuestionById(req, res) {
    try {
      const question = await SecurityQuestion.findById(req.params.id)
        .select('-hashedAnswer -salt');
      
      if (!question) {
        return res.status(404).json({
          success: false,
          error: 'Security question not found'
        });
      }
      
      // Get usage stats for this question
      const sessionStats = await SecuritySession.aggregate([
        { $match: { questionId: question.questionId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAttempts: { $sum: '$attempts' }
          }
        }
      ]);
      
      const questionData = question.toObject();
      questionData.sessionStats = sessionStats.reduce((acc, stat) => {
        acc[stat._id] = {
          count: stat.count,
          totalAttempts: stat.totalAttempts
        };
        return acc;
      }, {});
      
      res.json({
        success: true,
        data: questionData
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch security question'
      });
    }
  }
  
  // Create new security question
  async createQuestion(req, res) {
    try {
      const { questionText, answer, category, difficulty, isActive = true } = req.body;
      
      // Validate required fields
      if (!questionText || !answer || !category || !difficulty) {
        return res.status(400).json({
          success: false,
          error: 'Question text, answer, category, and difficulty are required'
        });
      }
      
      // Generate unique questionId
      const questionId = `${category}_${Date.now()}`;
      
      // Create question (answer will be hashed by pre-save hook)
      const question = new SecurityQuestion({
        questionId,
        questionText,
        answer, // Plain answer - will be hashed automatically
        category,
        difficulty,
        isActive: isActive !== false // Default to true
      });
      
      await question.save();
      
      // Return safe data (without hashed answer)
      const safeQuestion = question.toObject();
      delete safeQuestion.hashedAnswer;
      delete safeQuestion.salt;
      
      res.status(201).json({
        success: true,
        data: safeQuestion,
        message: 'Security question created successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to create security question'
      });
    }
  }
  
  // Update security question
  async updateQuestion(req, res) {
    try {
      const { questionText, answer, category, difficulty, isActive } = req.body;
      
      const question = await SecurityQuestion.findById(req.params.id);
      
      if (!question) {
        return res.status(404).json({
          success: false,
          error: 'Security question not found'
        });
      }
      
      // Update fields if provided
      const updates = {};
      if (questionText !== undefined) updates.questionText = questionText;
      if (category !== undefined) updates.category = category;
      if (difficulty !== undefined) updates.difficulty = difficulty;
      if (isActive !== undefined) updates.isActive = isActive;
      
      // If answer is being updated, set it (will be re-hashed)
      if (answer !== undefined) {
        updates.answer = answer; // Will trigger pre-save hook to re-hash
      }
      
      // Apply updates
      Object.assign(question, updates);
      await question.save();
      
      // Return safe data
      const safeQuestion = question.toObject();
      delete safeQuestion.hashedAnswer;
      delete safeQuestion.salt;
      
      res.json({
        success: true,
        data: safeQuestion,
        message: 'Security question updated successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update security question'
      });
    }
  }
  
  // Toggle question active status
  async toggleQuestionStatus(req, res) {
    try {
      const question = await SecurityQuestion.findById(req.params.id);
      
      if (!question) {
        return res.status(404).json({
          success: false,
          error: 'Security question not found'
        });
      }
      
      question.isActive = !question.isActive;
      await question.save();
      
      res.json({
        success: true,
        data: {
          id: question._id,
          isActive: question.isActive
        },
        message: `Question ${question.isActive ? 'activated' : 'deactivated'} successfully`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to toggle question status'
      });
    }
  }
  
  // Delete security question
  async deleteQuestion(req, res) {
    try {
      const question = await SecurityQuestion.findById(req.params.id);
      
      if (!question) {
        return res.status(404).json({
          success: false,
          error: 'Security question not found'
        });
      }
      
      // Check if question is being used in active sessions
      const activeSessions = await SecuritySession.countDocuments({
        questionId: question.questionId,
        status: 'valid',
        expiresAt: { $gt: new Date() }
      });
      
      if (activeSessions > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot delete question. It's being used in ${activeSessions} active session(s). Deactivate it instead.`
        });
      }
      
      await question.deleteOne();
      
      res.json({
        success: true,
        message: 'Security question deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete security question'
      });
    }
  }
  
  // Get security question statistics
  async getQuestionStats(req, res) {
    try {
      const stats = await SecurityQuestion.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
            inactive: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 0, 1] } },
            totalUsage: { $sum: '$usageCount' },
            avgUsage: { $avg: '$usageCount' },
            byCategory: {
              $push: {
                category: '$category',
                isActive: '$isActive',
                difficulty: '$difficulty'
              }
            }
          }
        },
        {
          $project: {
            total: 1,
            active: 1,
            inactive: 1,
            totalUsage: 1,
            avgUsage: 1,
            categories: {
              $arrayToObject: {
                $map: {
                  input: ['math', 'general', 'logic'],
                  as: 'cat',
                  in: {
                    k: '$$cat',
                    v: {
                      total: {
                        $size: {
                          $filter: {
                            input: '$byCategory',
                            as: 'item',
                            cond: { $eq: ['$$item.category', '$$cat'] }
                          }
                        }
                      },
                      active: {
                        $size: {
                          $filter: {
                            input: '$byCategory',
                            as: 'item',
                            cond: {
                              $and: [
                                { $eq: ['$$item.category', '$$cat'] },
                                { $eq: ['$$item.isActive', true] }
                              ]
                            }
                          }
                        }
                      },
                      difficulties: {
                        easy: {
                          $size: {
                            $filter: {
                              input: '$byCategory',
                              as: 'item',
                              cond: {
                                $and: [
                                  { $eq: ['$$item.category', '$$cat'] },
                                  { $eq: ['$$item.difficulty', 'easy'] }
                                ]
                              }
                            }
                          }
                        },
                        medium: {
                          $size: {
                            $filter: {
                              input: '$byCategory',
                              as: 'item',
                              cond: {
                                $and: [
                                  { $eq: ['$$item.category', '$$cat'] },
                                  { $eq: ['$$item.difficulty', 'medium'] }
                                ]
                              }
                            }
                          }
                        },
                        hard: {
                          $size: {
                            $filter: {
                              input: '$byCategory',
                              as: 'item',
                              cond: {
                                $and: [
                                  { $eq: ['$$item.category', '$$cat'] },
                                  { $eq: ['$$item.difficulty', 'hard'] }
                                ]
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      ]);
      
      // Get session statistics
      const sessionStats = await SecuritySession.aggregate([
        {
          $group: {
            _id: null,
            totalSessions: { $sum: 1 },
            validSessions: {
              $sum: { $cond: [{ $eq: ['$status', 'valid'] }, 1, 0] }
            },
            completedSessions: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            expiredSessions: {
              $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] }
            },
            failedSessions: {
              $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
            },
            totalAttempts: { $sum: '$attempts' },
            avgAttemptsPerSession: { $avg: '$attempts' }
          }
        }
      ]);
      
      const combinedStats = {
        ...(stats[0] || {
          total: 0,
          active: 0,
          inactive: 0,
          totalUsage: 0,
          avgUsage: 0,
          categories: {}
        }),
        sessionStats: sessionStats[0] || {
          totalSessions: 0,
          validSessions: 0,
          completedSessions: 0,
          expiredSessions: 0,
          failedSessions: 0,
          totalAttempts: 0,
          avgAttemptsPerSession: 0
        }
      };
      
      res.json({
        success: true,
        data: combinedStats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch security question statistics'
      });
    }
  }
  
  // Bulk import questions
  async bulkImportQuestions(req, res) {
    try {
      const { questions } = req.body;
      
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Questions array is required and cannot be empty'
        });
      }
      
      // Validate each question
      const validatedQuestions = [];
      const errors = [];
      
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        
        // Validate required fields
        if (!q.questionText || !q.answer || !q.category) {
          errors.push({
            index: i,
            question: q.questionText || 'Unknown',
            error: 'Missing required fields (questionText, answer, category)'
          });
          continue;
        }
        
        // Generate unique questionId
        const questionId = `${q.category}_${Date.now()}_${i}`;
        
        validatedQuestions.push({
          questionId,
          questionText: q.questionText.trim(),
          answer: q.answer.toString().trim(),
          category: q.category.toLowerCase(),
          difficulty: q.difficulty || 'easy',
          isActive: q.isActive !== undefined ? q.isActive : true
        });
      }
      
      // If all questions have errors
      if (validatedQuestions.length === 0 && errors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid questions to import',
          details: errors
        });
      }
      
      // Insert validated questions
      const inserted = await SecurityQuestion.insertMany(validatedQuestions);
      
      res.json({
        success: true,
        data: {
          imported: inserted.length,
          errors: errors.length,
          importedQuestions: inserted.map(q => q.questionId),
          errorDetails: errors
        },
        message: `Imported ${inserted.length} security questions successfully`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to import security questions'
      });
    }
  }
  
  // Export questions (for backup or migration)
  async exportQuestions(req, res) {
    try {
      const questions = await SecurityQuestion.find()
        .select('questionId questionText category difficulty isActive usageCount lastUsed createdAt updatedAt')
        .sort({ createdAt: -1 });
      
      // Set headers for file download
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=security-questions-export.json');
      
      res.json({
        success: true,
        data: questions,
        exportedAt: new Date().toISOString(),
        count: questions.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to export security questions'
      });
    }
  }
  
  // ========== SECURITY SESSIONS MANAGEMENT ==========
  
  // Get active security sessions
  async getActiveSessions(req, res) {
    try {
      const { page = 1, limit = 50 } = req.query;
      const skip = (page - 1) * limit;
      
      const [sessions, total] = await Promise.all([
        SecuritySession.find({
          status: 'valid',
          expiresAt: { $gt: new Date() }
        })
          .populate('userId', 'email firstName lastName')
          .sort({ expiresAt: 1 })
          .skip(skip)
          .limit(parseInt(limit)),
        SecuritySession.countDocuments({
          status: 'valid',
          expiresAt: { $gt: new Date() }
        })
      ]);
      
      res.json({
        success: true,
        data: sessions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch active security sessions'
      });
    }
  }
  
  // Get expired security sessions
  async getExpiredSessions(req, res) {
    try {
      const { page = 1, limit = 50 } = req.query;
      const skip = (page - 1) * limit;
      
      const [sessions, total] = await Promise.all([
        SecuritySession.find({
          $or: [
            { status: 'expired' },
            { expiresAt: { $lt: new Date() } }
          ]
        })
          .populate('userId', 'email firstName lastName')
          .sort({ expiresAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        SecuritySession.countDocuments({
          $or: [
            { status: 'expired' },
            { expiresAt: { $lt: new Date() } }
          ]
        })
      ]);
      
      res.json({
        success: true,
        data: sessions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch expired security sessions'
      });
    }
  }
  
  // Get session by ID
  async getSessionById(req, res) {
    try {
      const session = await SecuritySession.findOne({ sessionId: req.params.sessionId })
        .populate('userId', 'email firstName lastName userType role');
      
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Security session not found'
        });
      }
      
      // Get the associated question
      const question = await SecurityQuestion.findOne({ 
        questionId: session.questionId 
      }).select('questionText category difficulty');
      
      const sessionData = session.toObject();
      if (question) {
        sessionData.question = question;
      }
      
      res.json({
        success: true,
        data: sessionData
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch security session'
      });
    }
  }
  
  // Delete a security session
  async deleteSession(req, res) {
    try {
      const session = await SecuritySession.findOneAndDelete({ 
        sessionId: req.params.sessionId 
      });
      
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Security session not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Security session deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete security session'
      });
    }
  }
  
  // Cleanup expired sessions
  async cleanupExpiredSessions(req, res) {
    try {
      const result = await SecuritySession.cleanupExpiredSessions();
      
      res.json({
        success: true,
        data: {
          deletedCount: result,
          message: `Cleaned up ${result} expired security sessions`
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to cleanup expired sessions'
      });
    }
  }
  
  // Get session statistics
  async getSessionStats(req, res) {
    try {
      const stats = await SecuritySession.aggregate([
        {
          $facet: {
            // Overall stats
            overall: [
              {
                $group: {
                  _id: null,
                  totalSessions: { $sum: 1 },
                  validSessions: {
                    $sum: { $cond: [{ $eq: ['$status', 'valid'] }, 1, 0] }
                  },
                  completedSessions: {
                    $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                  },
                  expiredSessions: {
                    $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] }
                  },
                  failedSessions: {
                    $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                  },
                  totalAttempts: { $sum: '$attempts' },
                  avgAttemptsPerSession: { $avg: '$attempts' },
                  uniqueUsers: { $addToSet: '$userId' }
                }
              },
              {
                $project: {
                  _id: 0,
                  totalSessions: 1,
                  validSessions: 1,
                  completedSessions: 1,
                  expiredSessions: 1,
                  failedSessions: 1,
                  totalAttempts: 1,
                  avgAttemptsPerSession: 1,
                  uniqueUsers: { $size: '$uniqueUsers' }
                }
              }
            ],
            // Daily stats for last 30 days
            dailyStats: [
              {
                $match: {
                  createdAt: {
                    $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                  }
                }
              },
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                  },
                  count: { $sum: 1 },
                  completed: {
                    $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                  }
                }
              },
              { $sort: { _id: 1 } }
            ],
            // By usage purpose
            byPurpose: [
              {
                $group: {
                  _id: '$usedFor',
                  count: { $sum: 1 },
                  completed: {
                    $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                  }
                }
              }
            ],
            // By status
            byStatus: [
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 },
                  avgAttempts: { $avg: '$attempts' }
                }
              }
            ]
          }
        }
      ]);
      
      res.json({
        success: true,
        data: {
          overall: stats[0]?.overall[0] || {},
          dailyStats: stats[0]?.dailyStats || [],
          byPurpose: stats[0]?.byPurpose || [],
          byStatus: stats[0]?.byStatus || []
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch session statistics'
      });
    }
  }
}

module.exports = new SecurityQuestionsController();