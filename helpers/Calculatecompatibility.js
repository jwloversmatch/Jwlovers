/**
 * FIXED COMPATIBILITY CALCULATION
 * Now checks preferences FIRST before calculating similarity scores
 */

const DatingUser = require("@models/User").DatingUser;

/**
 * Calculate compatibility between two users
 * Returns 0 if users don't meet each other's basic preferences
 * Returns 1-100 based on similarity if preferences match
 */
const calculateCompatibility = async (user1Id, user2Id) => {
  try {
    // Get both users with their profiles
    const [user1, user2] = await Promise.all([
      DatingUser.findById(user1Id).populate('profile'),
      DatingUser.findById(user2Id).populate('profile')
    ]);
    
    if (!user1 || !user2 || !user1.profile || !user2.profile) {
      return 50; // Default score if data is incomplete
    }
    
    // ========== STEP 1: VALIDATE PREFERENCES (MUST PASS) ==========
    
    // Get preferences and basic info
    const user1Prefs = user1.profile.preferences?.basic || {};
    const user2Prefs = user2.profile.preferences?.basic || {};
    const user1Age = user1.profile.age;
    const user2Age = user2.profile.age;
    const user1Gender = user1.profile.basic?.gender;
    const user2Gender = user2.profile.basic?.gender;
    
    // Check if user2 is within user1's age preferences
    if (user1Prefs.ageRange) {
      if (user2Age < user1Prefs.ageRange.min || user2Age > user1Prefs.ageRange.max) {
        return 0; // Instant fail - outside age range
      }
    }
    
    // Check if user1 is within user2's age preferences (mutual check)
    if (user2Prefs.ageRange) {
      if (user1Age < user2Prefs.ageRange.min || user1Age > user2Prefs.ageRange.max) {
        return 0; // Instant fail - outside age range
      }
    }
    
    // Check if user2's gender matches user1's preferences
    if (user1Prefs.gender && Array.isArray(user1Prefs.gender) && user1Prefs.gender.length > 0) {
      if (!user1Prefs.gender.includes('any') && !user1Prefs.gender.includes(user2Gender)) {
        return 0; // Instant fail - wrong gender
      }
    }
    
    // Check if user1's gender matches user2's preferences (mutual check)
    if (user2Prefs.gender && Array.isArray(user2Prefs.gender) && user2Prefs.gender.length > 0) {
      if (!user2Prefs.gender.includes('any') && !user2Prefs.gender.includes(user1Gender)) {
        return 0; // Instant fail - wrong gender
      }
    }
    
    // Check relationship goals compatibility
    const user1Goals = user1.profile.relationship?.lookingFor || [];
    const user2Goals = user2.profile.relationship?.lookingFor || [];
    if (user1Goals.length > 0 && user2Goals.length > 0) {
      const hasCommonGoal = user1Goals.some(goal => user2Goals.includes(goal));
      if (!hasCommonGoal) {
        return 0; // Instant fail - incompatible relationship goals
      }
    }
    
    // ========== STEP 2: CALCULATE SIMILARITY SCORES ==========
    
    // Start with base score for passing preference checks
    let score = 50;
    
    // Age compatibility (max 15 points)
    if (user1Age && user2Age) {
      const ageDiff = Math.abs(user1Age - user2Age);
      if (ageDiff <= 2) score += 15;
      else if (ageDiff <= 5) score += 10;
      else if (ageDiff <= 10) score += 5;
    }
    
    // Religion compatibility (max 10 points)
    if (user1.profile.faith?.servingAs && user2.profile.faith?.servingAs) {
      if (user1.profile.faith.servingAs === user2.profile.faith.servingAs) {
        score += 10;
      } else {
        // Partial points for similar service levels
        const serviceHierarchy = {
          'regular_publisher': 1,
          'auxiliary_pioneer': 2,
          'regular_pioneer': 3,
          'ministerial_servant': 4,
          'elder': 5
        };
        const service1 = serviceHierarchy[user1.profile.faith.servingAs] || 0;
        const service2 = serviceHierarchy[user2.profile.faith.servingAs] || 0;
        if (Math.abs(service1 - service2) <= 1) score += 5;
      }
    }
    
    // Education compatibility (max 10 points)
    if (user1.profile.career?.education?.level && user2.profile.career?.education?.level) {
      const educationLevels = {
        high_school: 1,
        some_college: 2,
        associates: 3,
        bachelors: 4,
        masters: 5,
        phd: 6,
      };
      
      const edu1 = educationLevels[user1.profile.career.education.level] || 0;
      const edu2 = educationLevels[user2.profile.career.education.level] || 0;
      
      if (Math.abs(edu1 - edu2) === 0) score += 10;
      else if (Math.abs(edu1 - edu2) === 1) score += 7;
      else if (Math.abs(edu1 - edu2) === 2) score += 4;
    }
    
    // Hobbies/Interests compatibility (max 15 points)
    if (user1.profile.lifestyle?.hobbies && user2.profile.lifestyle?.hobbies) {
      const hobbies1 = user1.profile.lifestyle.hobbies;
      const hobbies2 = user2.profile.lifestyle.hobbies;
      const commonHobbies = hobbies1.filter(hobby => hobbies2.includes(hobby)).length;
      
      if (hobbies1.length > 0 && hobbies2.length > 0) {
        const maxHobbies = Math.max(hobbies1.length, hobbies2.length);
        const matchPercentage = (commonHobbies / maxHobbies) * 15;
        score += Math.round(matchPercentage);
      }
    }
    
    // Personality compatibility (max 10 points)
    if (user1.profile.personality?.introvertExtrovert && user2.profile.personality?.introvertExtrovert) {
      if (user1.profile.personality.introvertExtrovert === user2.profile.personality.introvertExtrovert) {
        score += 10;
      } else if (
        (user1.profile.personality.introvertExtrovert === 'ambivert') ||
        (user2.profile.personality.introvertExtrovert === 'ambivert')
      ) {
        score += 5; // Ambiverts are compatible with everyone
      }
    }
    
    // Communication style compatibility (max 5 points)
    if (user1.profile.personality?.communicationStyle && user2.profile.personality?.communicationStyle) {
      if (user1.profile.personality.communicationStyle === user2.profile.personality.communicationStyle) {
        score += 5;
      } else if (
        user1.profile.personality.communicationStyle === 'mixed' ||
        user2.profile.personality.communicationStyle === 'mixed'
      ) {
        score += 3;
      }
    }
    
    // Lifestyle compatibility - Exercise (max 5 points)
    if (user1.profile.lifestyle?.exercise?.frequency && user2.profile.lifestyle?.exercise?.frequency) {
      const exerciseLevels = {
        never: 1,
        occasionally: 2,
        '1-2_times_week': 3,
        '3-4_times_week': 4,
        daily: 5
      };
      const ex1 = exerciseLevels[user1.profile.lifestyle.exercise.frequency] || 0;
      const ex2 = exerciseLevels[user2.profile.lifestyle.exercise.frequency] || 0;
      
      if (Math.abs(ex1 - ex2) <= 1) score += 5;
      else if (Math.abs(ex1 - ex2) === 2) score += 3;
    }
    
    // ========== STEP 3: APPLY BOOST (BONUS POINTS, NOT MULTIPLIER) ==========
    
    if (user1.boost?.isActive && user1.boost.expiresAt && new Date(user1.boost.expiresAt) > new Date()) {
      const boostBonus = {
        regular: 10,
        super: 15,
        mega: 20
      };
      score += boostBonus[user1.boost.boostType] || 10;
    }
    
    // Cap at 100
    return Math.min(Math.round(score), 100);
    
  } catch (error) {
    console.error("Compatibility calculation error:", error);
    return 50; // Default fallback score
  }
};

/**
 * Synchronous version for batch processing (when users are already loaded)
 */
const calculateCompatibilitySync = (user1, user2) => {
  if (!user1 || !user2 || !user1.profile || !user2.profile) {
    return 50;
  }
  
  // Same logic as above but synchronous (no await)
  // Copy the logic from above but remove async/await
  
  // Get preferences and basic info
  const user1Prefs = user1.profile.preferences?.basic || {};
  const user2Prefs = user2.profile.preferences?.basic || {};
  const user1Age = user1.profile.age;
  const user2Age = user2.profile.age;
  const user1Gender = user1.profile.basic?.gender;
  const user2Gender = user2.profile.basic?.gender;
  
  // Preference validation
  if (user1Prefs.ageRange) {
    if (user2Age < user1Prefs.ageRange.min || user2Age > user1Prefs.ageRange.max) {
      return 0;
    }
  }
  
  if (user2Prefs.ageRange) {
    if (user1Age < user2Prefs.ageRange.min || user1Age > user2Prefs.ageRange.max) {
      return 0;
    }
  }
  
  if (user1Prefs.gender && Array.isArray(user1Prefs.gender) && user1Prefs.gender.length > 0) {
    if (!user1Prefs.gender.includes('any') && !user1Prefs.gender.includes(user2Gender)) {
      return 0;
    }
  }
  
  if (user2Prefs.gender && Array.isArray(user2Prefs.gender) && user2Prefs.gender.length > 0) {
    if (!user2Prefs.gender.includes('any') && !user2Prefs.gender.includes(user1Gender)) {
      return 0;
    }
  }
  
  const user1Goals = user1.profile.relationship?.lookingFor || [];
  const user2Goals = user2.profile.relationship?.lookingFor || [];
  if (user1Goals.length > 0 && user2Goals.length > 0) {
    const hasCommonGoal = user1Goals.some(goal => user2Goals.includes(goal));
    if (!hasCommonGoal) {
      return 0;
    }
  }
  
  // Calculate similarity (same logic as async version)
  let score = 50;
  
  // Age
  if (user1Age && user2Age) {
    const ageDiff = Math.abs(user1Age - user2Age);
    if (ageDiff <= 2) score += 15;
    else if (ageDiff <= 5) score += 10;
    else if (ageDiff <= 10) score += 5;
  }
  
  // Religion/Service
  if (user1.profile.faith?.servingAs && user2.profile.faith?.servingAs) {
    if (user1.profile.faith.servingAs === user2.profile.faith.servingAs) {
      score += 10;
    } else {
      const serviceHierarchy = {
        'regular_publisher': 1,
        'auxiliary_pioneer': 2,
        'regular_pioneer': 3,
        'ministerial_servant': 4,
        'elder': 5
      };
      const service1 = serviceHierarchy[user1.profile.faith.servingAs] || 0;
      const service2 = serviceHierarchy[user2.profile.faith.servingAs] || 0;
      if (Math.abs(service1 - service2) <= 1) score += 5;
    }
  }
  
  // Hobbies
  if (user1.profile.lifestyle?.hobbies && user2.profile.lifestyle?.hobbies) {
    const hobbies1 = user1.profile.lifestyle.hobbies;
    const hobbies2 = user2.profile.lifestyle.hobbies;
    const commonHobbies = hobbies1.filter(hobby => hobbies2.includes(hobby)).length;
    
    if (hobbies1.length > 0 && hobbies2.length > 0) {
      const maxHobbies = Math.max(hobbies1.length, hobbies2.length);
      const matchPercentage = (commonHobbies / maxHobbies) * 15;
      score += Math.round(matchPercentage);
    }
  }
  
  // Boost bonus
  if (user1.boost?.isActive && user1.boost.expiresAt && new Date(user1.boost.expiresAt) > new Date()) {
    const boostBonus = {
      regular: 10,
      super: 15,
      mega: 20
    };
    score += boostBonus[user1.boost.boostType] || 10;
  }
  
  return Math.min(Math.round(score), 100);
};

module.exports = {
  calculateCompatibility,
  calculateCompatibilitySync
};