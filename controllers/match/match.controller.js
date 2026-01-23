const Profile = require("@models/Profile.model");
const { BaseUser, DatingUser, UserQuery } = require("@models/User");
const Match = require("@models/Match.model");

// Helper function to validate dating user
const validateDatingUser = async (userId) => {
  const user = await UserQuery.getUserById(userId);
  
  if (!user) {
    throw new Error("User not found");
  }
  
  if (user.userType !== 'DatingUser') {
    throw new Error("Match features only available for dating users");
  }
  
  return user;
};

// Helper function to calculate compatibility
const calculateCompatibility = (profile1, profile2) => {
  // Base compatibility score
  let score = 50;
  
  // Age compatibility (within 5 years is best)
  const ageDiff = Math.abs(profile1.age - profile2.age);
  if (ageDiff <= 2) score += 15;
  else if (ageDiff <= 5) score += 10;
  else if (ageDiff <= 10) score += 5;
  
  // Religion compatibility
  if (profile1.religion && profile2.religion) {
    if (profile1.religion === profile2.religion) score += 10;
  }
  
  // Education compatibility
  if (profile1.education && profile2.education) {
    const educationLevels = {
      'high_school': 1,
      'associate': 2,
      'bachelor': 3,
      'master': 4,
      'phd': 5
    };
    
    const edu1 = educationLevels[profile1.education] || 0;
    const edu2 = educationLevels[profile2.education] || 0;
    
    if (Math.abs(edu1 - edu2) <= 1) score += 10;
  }
  
  // Want children compatibility
  if (profile1.wantsChildren && profile2.wantsChildren) {
    if (profile1.wantsChildren === profile2.wantsChildren) score += 15;
  }
  
  // Cap score at 100
  return Math.min(Math.round(score), 100);
};

// Find potential matches
exports.findMatches = async (req, res) => {
  try {
    const { limit = 20, skip = 0 } = req.query;
    const userId = req.user?.id || req.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User authentication required"
      });
    }

    // Validate user is a dating user
    try {
      await validateDatingUser(userId);
    } catch (error) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    const userProfile = await Profile.findOne({ userId });
    if (!userProfile) {
      return res.status(404).json({
        success: false,
        error: "Profile not found"
      });
    }

    // Build query based on preferences
    const query = {
      userId: { $ne: userId },
      accountStatus: 'active',
    };

    // Gender filter
    if (userProfile.matchPreferences?.gender) {
      if (userProfile.matchPreferences.gender === 'both') {
        query.gender = { $in: ['male', 'female'] };
      } else {
        query.gender = userProfile.matchPreferences.gender;
      }
    }

    // Age filter
    if (userProfile.matchPreferences?.ageRange) {
      query.age = {
        $gte: userProfile.matchPreferences.ageRange.min || 18,
        $lte: userProfile.matchPreferences.ageRange.max || 99
      };
    }

    // Religion filter
    if (userProfile.matchPreferences?.religion) {
      query.religion = userProfile.matchPreferences.religion;
    }

    // Exclude already liked/disliked users
    const likedUsers = userProfile.likes || [];
    const dislikedUsers = userProfile.dislikes || [];
    const blockedUsers = userProfile.blocked || [];
    
    const excludedUsers = [...likedUsers, ...dislikedUsers, ...blockedUsers];
    if (excludedUsers.length > 0) {
      query.userId = { 
        $ne: userId,
        $nin: excludedUsers 
      };
    }

    // Find potential matches with profiles
    const potentialMatches = await Profile.find(query)
      .populate('user', 'firstName lastName lastActive')
      .sort({ profileCompletion: -1, lastActive: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    // Get user details for each profile
    const matchesWithDetails = await Promise.all(
      potentialMatches.map(async (profile) => {
        const user = await DatingUser.findById(profile.userId)
          .select('firstName lastName avatar userName');
        
        return {
          profile,
          user: user || { firstName: 'Unknown', lastName: 'User' }
        };
      })
    );

    // Format response
    const matches = matchesWithDetails.map(({ profile, user }) => ({
      profile: {
        userId: profile.userId,
        userName: profile.userName || user.userName,
        profilePicture: profile.profilePicture || user.avatar,
        age: profile.age,
        gender: profile.gender,
        bio: profile.bio,
        location: profile.currentLocation?.city,
        religion: profile.religion,
        occupation: profile.occupation,
        education: profile.education,
        wantsChildren: profile.wantsChildren,
        profileCompletion: profile.profileCompletion || 0,
        lastActive: profile.lastActive || user.lastActive,
      },
      compatibility: calculateCompatibility(userProfile, profile)
    }));

    res.json({
      success: true,
      data: {
        matches,
        count: matches.length,
        total: await Profile.countDocuments(query),
        pagination: {
          limit: parseInt(limit),
          skip: parseInt(skip)
        }
      },
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Find matches error:", error);
    res.status(500).json({
      success: false,
      error: "Unable to find matches",
      code: "MATCH_ERROR",
      timestamp: new Date().toISOString()
    });
  }
};

// Like a user
exports.likeUser = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const userId = req.user?.id || req.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User authentication required"
      });
    }

    // Validate both users are dating users
    try {
      await validateDatingUser(userId);
      await validateDatingUser(targetUserId);
    } catch (error) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    // Check if trying to like self
    if (userId === targetUserId) {
      return res.status(400).json({
        success: false,
        error: "Cannot like yourself"
      });
    }

    // Get both profiles
    const [userProfile, targetProfile] = await Promise.all([
      Profile.findOne({ userId }),
      Profile.findOne({ userId: targetUserId })
    ]);

    if (!userProfile || !targetProfile) {
      return res.status(404).json({
        success: false,
        error: "Profile not found"
      });
    }

    // Check if already liked
    if (userProfile.likes && userProfile.likes.includes(targetUserId)) {
      return res.status(400).json({
        success: false,
        error: "Already liked this user"
      });
    }

    // Check if blocked
    if (userProfile.blocked && userProfile.blocked.includes(targetUserId)) {
      return res.status(403).json({
        success: false,
        error: "User is blocked"
      });
    }

    // Check if target has blocked the user
    if (targetProfile.blocked && targetProfile.blocked.includes(userId)) {
      return res.status(403).json({
        success: false,
        error: "Cannot like this user"
      });
    }

    // Add to likes
    userProfile.likes = userProfile.likes || [];
    userProfile.likes.push(targetUserId);
    await userProfile.save();

    // Calculate compatibility
    const compatibilityScore = calculateCompatibility(userProfile, targetProfile);

    // Check if it's a mutual like (creates a match)
    const isMutualLike = targetProfile.likes && targetProfile.likes.includes(userId);
    
    if (isMutualLike) {
      // Check if match already exists
      const existingMatch = await Match.findOne({
        $or: [
          { user1: userId, user2: targetUserId },
          { user1: targetUserId, user2: userId }
        ]
      });

      if (existingMatch) {
        return res.status(400).json({
          success: false,
          error: "Match already exists"
        });
      }

      // Create a match
      const match = await Match.create({
        user1: userId,
        user2: targetUserId,
        compatibilityScore,
        matchedAt: new Date(),
        status: 'active'
      });

      // Update both profiles
      userProfile.matches = userProfile.matches || [];
      userProfile.matches.push({
        user: targetUserId,
        matchId: match._id,
        matchedAt: new Date()
      });
      userProfile.matchCount = (userProfile.matchCount || 0) + 1;
      await userProfile.save();

      targetProfile.matches = targetProfile.matches || [];
      targetProfile.matches.push({
        user: userId,
        matchId: match._id,
        matchedAt: new Date()
      });
      targetProfile.matchCount = (targetProfile.matchCount || 0) + 1;
      await targetProfile.save();

      // Update match count in DatingUser model
      await Promise.all([
        DatingUser.findByIdAndUpdate(userId, {
          $inc: { 'stats.matchCount': 1 }
        }),
        DatingUser.findByIdAndUpdate(targetUserId, {
          $inc: { 'stats.matchCount': 1 }
        })
      ]);

      return res.json({
        success: true,
        message: "It's a match!",
        data: {
          match: true,
          matchId: match._id,
          compatibilityScore,
          targetUser: {
            userId: targetUserId,
            userName: targetProfile.userName,
            profilePicture: targetProfile.profilePicture
          }
        },
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString()
        }
      });
    }

    res.json({
      success: true,
      message: "Like sent successfully",
      data: {
        match: false,
        compatibilityScore
      },
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Like user error:", error);
    res.status(500).json({
      success: false,
      error: "Unable to like user",
      code: "LIKE_ERROR",
      timestamp: new Date().toISOString()
    });
  }
};

// Dislike a user
exports.dislikeUser = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const userId = req.user?.id || req.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User authentication required"
      });
    }

    // Validate both users are dating users
    try {
      await validateDatingUser(userId);
    } catch (error) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    // Check if trying to dislike self
    if (userId === targetUserId) {
      return res.status(400).json({
        success: false,
        error: "Cannot dislike yourself"
      });
    }

    const userProfile = await Profile.findOne({ userId });
    if (!userProfile) {
      return res.status(404).json({
        success: false,
        error: "Profile not found"
      });
    }

    // Add to dislikes
    userProfile.dislikes = userProfile.dislikes || [];
    
    // Check if already disliked
    if (userProfile.dislikes.includes(targetUserId)) {
      return res.status(400).json({
        success: false,
        error: "Already disliked this user"
      });
    }

    userProfile.dislikes.push(targetUserId);
    await userProfile.save();

    res.json({
      success: true,
      message: "User disliked",
      data: {
        dislikedUserId: targetUserId
      },
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Dislike user error:", error);
    res.status(500).json({
      success: false,
      error: "Unable to dislike user",
      code: "DISLIKE_ERROR",
      timestamp: new Date().toISOString()
    });
  }
};

// Get mutual likes
exports.getMutualLikes = async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User authentication required"
      });
    }

    // Validate user is a dating user
    try {
      await validateDatingUser(userId);
    } catch (error) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    const userProfile = await Profile.findOne({ userId });
    if (!userProfile) {
      return res.status(404).json({
        success: false,
        error: "Profile not found"
      });
    }

    // Find users who liked the current user
    const profilesWhoLikedUser = await Profile.find({
      userId: { $ne: userId },
      likes: userId
    }).populate('user', 'firstName lastName');

    // Find mutual likes (users who liked each other but haven't matched yet)
    const mutualLikes = [];
    const userLikes = userProfile.likes || [];

    for (const profile of profilesWhoLikedUser) {
      if (userLikes.includes(profile.userId)) {
        // Check if already matched
        const existingMatch = await Match.findOne({
          $or: [
            { user1: userId, user2: profile.userId },
            { user1: profile.userId, user2: userId }
          ]
        });

        if (!existingMatch) {
          const targetUser = await DatingUser.findById(profile.userId)
            .select('firstName lastName avatar userName');
          
          mutualLikes.push({
            userId: profile.userId,
            userName: profile.userName || targetUser?.userName,
            profilePicture: profile.profilePicture || targetUser?.avatar,
            age: profile.age,
            gender: profile.gender,
            bio: profile.bio,
            location: profile.currentLocation?.city,
            likedAt: profile.updatedAt // Approximate time of like
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        mutualLikes,
        count: mutualLikes.length
      },
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Get mutual likes error:", error);
    res.status(500).json({
      success: false,
      error: "Unable to get mutual likes",
      code: "MUTUAL_LIKES_ERROR",
      timestamp: new Date().toISOString()
    });
  }
};