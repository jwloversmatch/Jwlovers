/**
 * DATA CONSISTENCY HELPERS
 * 
 * These helpers ensure preferences are handled consistently
 * across Profile and DatingUser models
 */

/**
 * Get unified preferences for a user
 * Combines preferences from both Profile and DatingUser models
 * Profile.preferences takes priority (newer structure)
 */
const getUnifiedPreferences = (datingUser) => {
  if (!datingUser || !datingUser.profile) {
    return null;
  }
  
  const profile = datingUser.profile;
  
  return {
    // Basic preferences (from Profile.preferences.basic)
    gender: profile.preferences?.basic?.gender || [],
    ageRange: profile.preferences?.basic?.ageRange || { min: 18, max: 45 },
    distance: profile.preferences?.basic?.distance || 50,
    
    // Faith preferences (from Profile.preferences.faith)
    mustBeJW: profile.preferences?.faith?.mustBeJW !== false, // default true
    servingAs: profile.preferences?.faith?.servingAs || [],
    pioneerPreferred: profile.preferences?.faith?.pioneerPreferred || false,
    
    // Relationship preferences (from Profile.preferences.relationship)
    relationshipGoals: profile.preferences?.relationship?.goals || [],
    acceptChildren: profile.preferences?.relationship?.children?.accept !== false,
    wantMoreChildren: profile.preferences?.relationship?.children?.wantMore || null,
    
    // Dealbreakers (from Profile.preferences.dealbreakers)
    mustHaves: profile.preferences?.dealbreakers?.mustHaves || [],
    dealBreakers: profile.preferences?.dealbreakers?.dealBreakers || [],
    
    // Fallback to old structure if new one doesn't exist
    // This ensures backward compatibility
    ...(datingUser.datingPreferences && !profile.preferences?.basic ? {
      ageRange: datingUser.datingPreferences.ageRange,
      distance: datingUser.datingPreferences.distance
    } : {})
  };
};

/**
 * Check if user meets another user's preferences
 * Returns true if compatible, false otherwise
 */
const meetsPreferences = (targetUser, viewerPreferences) => {
  if (!targetUser || !targetUser.profile || !viewerPreferences) {
    return false;
  }
  
  const targetProfile = targetUser.profile;
  const targetAge = targetProfile.age;
  const targetGender = targetProfile.basic?.gender;
  
  // Age check
  if (viewerPreferences.ageRange) {
    if (targetAge < viewerPreferences.ageRange.min || 
        targetAge > viewerPreferences.ageRange.max) {
      return false;
    }
  }
  
  // Gender check
  if (viewerPreferences.gender && viewerPreferences.gender.length > 0) {
    if (!viewerPreferences.gender.includes('any') && 
        !viewerPreferences.gender.includes(targetGender)) {
      return false;
    }
  }
  
  // JW requirement
  if (viewerPreferences.mustBeJW) {
    if (!targetProfile.faith?.baptismDate) {
      return false; // Not baptized
    }
  }
  
  // Service requirement
  if (viewerPreferences.servingAs && viewerPreferences.servingAs.length > 0) {
    if (!viewerPreferences.servingAs.includes(targetProfile.faith?.servingAs)) {
      return false;
    }
  }
  
  // Pioneer preference
  if (viewerPreferences.pioneerPreferred) {
    const pioneerRoles = ['auxiliary_pioneer', 'regular_pioneer', 'special_pioneer'];
    if (!pioneerRoles.includes(targetProfile.faith?.servingAs)) {
      return false;
    }
  }
  
  // Relationship goals
  if (viewerPreferences.relationshipGoals && viewerPreferences.relationshipGoals.length > 0) {
    const targetGoals = targetProfile.relationship?.lookingFor || [];
    const hasCommonGoal = viewerPreferences.relationshipGoals.some(
      goal => targetGoals.includes(goal)
    );
    if (!hasCommonGoal) {
      return false;
    }
  }
  
  // Children preferences
  if (viewerPreferences.acceptChildren === false) {
    if (targetProfile.relationship?.children?.have === 'yes') {
      return false;
    }
  }
  
  // Dealbreakers
  if (viewerPreferences.dealBreakers && viewerPreferences.dealBreakers.length > 0) {
    // Check if target has any dealbreakers
    // This is app-specific logic - customize as needed
    for (const dealbreaker of viewerPreferences.dealBreakers) {
      // Example: if dealbreaker is 'smoking' and target smokes
      if (dealbreaker === 'smoking' && 
          targetProfile.lifestyle?.smoking && 
          targetProfile.lifestyle.smoking !== 'never') {
        return false;
      }
      // Add more dealbreaker checks as needed
    }
  }
  
  return true;
};

/**
 * Check mutual compatibility (bidirectional)
 */
const areMutuallyCompatible = (user1, user2) => {
  const user1Prefs = getUnifiedPreferences(user1);
  const user2Prefs = getUnifiedPreferences(user2);
  
  if (!user1Prefs || !user2Prefs) {
    return false;
  }
  
  // Check both directions
  const user1Compatible = meetsPreferences(user2, user1Prefs);
  const user2Compatible = meetsPreferences(user1, user2Prefs);
  
  return user1Compatible && user2Compatible;
};

/**
 * Build optimized match query with proper field references
 */
const buildMatchQuery = (currentUser, options = {}) => {
  const prefs = getUnifiedPreferences(currentUser);
  
  if (!prefs) {
    throw new Error('Unable to get user preferences');
  }
  
  const query = {
    _id: { $ne: currentUser._id },
    'profile.settings.isVisible': true,
    'profile.settings.isPaused': false,
    isShadowBanned: false
  };
  
  // Gender filter
  if (prefs.gender.length > 0 && !prefs.gender.includes('any')) {
    query['profile.basic.gender'] = { $in: prefs.gender };
  }
  
  // Age filter (using stored age if available, otherwise dateOfBirth)
  if (prefs.ageRange) {
    // Check if profile has stored age field
    if (currentUser.profile.basic?.age !== undefined) {
      query['profile.basic.age'] = {
        $gte: prefs.ageRange.min,
        $lte: prefs.ageRange.max
      };
    } else {
      // Fall back to dateOfBirth calculation
      const today = new Date();
      const minBirthDate = new Date(
        today.getFullYear() - prefs.ageRange.max - 1,
        today.getMonth(),
        today.getDate()
      );
      const maxBirthDate = new Date(
        today.getFullYear() - prefs.ageRange.min,
        today.getMonth(),
        today.getDate()
      );
      
      query['profile.basic.dateOfBirth'] = {
        $gte: minBirthDate,
        $lte: maxBirthDate
      };
    }
  }
  
  // JW requirement
  if (prefs.mustBeJW) {
    query['profile.faith.baptismDate'] = { $exists: true, $ne: null };
  }
  
  // Service requirement
  if (prefs.servingAs && prefs.servingAs.length > 0) {
    query['profile.faith.servingAs'] = { $in: prefs.servingAs };
  }
  
  // Pioneer preference
  if (prefs.pioneerPreferred) {
    query['profile.faith.servingAs'] = { 
      $in: ['auxiliary_pioneer', 'regular_pioneer', 'special_pioneer'] 
    };
  }
  
  // Relationship goals
  if (prefs.relationshipGoals && prefs.relationshipGoals.length > 0) {
    query['profile.relationship.lookingFor'] = { 
      $in: prefs.relationshipGoals 
    };
  }
  
  // Location filter (with validation)
  if (currentUser.profile.location?.coordinates && prefs.distance) {
    const coords = currentUser.profile.location.coordinates;
    
    // Only apply if valid coordinates (not [0, 0])
    if (coords[0] !== 0 || coords[1] !== 0) {
      query['profile.location.coordinates'] = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: coords
          },
          $maxDistance: prefs.distance * 1000 // Convert km to meters
        }
      };
    }
  }
  
  // Exclude seen profiles
  if (options.excludeSeen && currentUser.seenProfiles?.length > 0) {
    query['profile._id'] = { $nin: currentUser.seenProfiles };
  }
  
  // Exclude liked profiles
  if (options.excludeLiked && currentUser.likedProfiles?.length > 0) {
    const likedProfileIds = currentUser.likedProfiles
      .map(lp => lp.profile)
      .filter(Boolean);
    
    if (likedProfileIds.length > 0) {
      if (query['profile._id']) {
        // Merge with existing $nin
        query['profile._id'].$nin = [
          ...query['profile._id'].$nin,
          ...likedProfileIds
        ];
      } else {
        query['profile._id'] = { $nin: likedProfileIds };
      }
    }
  }
  
  // Minimum profile completion
  if (options.minCompletion) {
    query['profile.progress.completion'] = { $gte: options.minCompletion };
  }
  
  return query;
};

/**
 * Migrate old preferences to new structure
 * Run this once to migrate existing user data
 */
const migratePreferences = async (DatingUser, Profile) => {
  const users = await DatingUser.find({
    datingPreferences: { $exists: true }
  }).populate('profile');
  
  let migrated = 0;
  
  for (const user of users) {
    if (!user.profile) continue;
    
    const profile = user.profile;
    
    // Only migrate if new structure doesn't exist
    if (!profile.preferences?.basic) {
      profile.preferences = profile.preferences || {};
      profile.preferences.basic = {
        gender: [], // Will need manual migration
        ageRange: user.datingPreferences.ageRange || { min: 18, max: 45 },
        distance: user.datingPreferences.distance || 50
      };
      
      await profile.save();
      migrated++;
    }
  }
  
  console.log(`✅ Migrated preferences for ${migrated} users`);
  return migrated;
};

module.exports = {
  getUnifiedPreferences,
  meetsPreferences,
  areMutuallyCompatible,
  buildMatchQuery,
  migratePreferences
};