// services/option.service.js
const Option = require('@models/Option.model');

class OptionService {
  constructor() {
    this.cache = new Map();
    this.lastUpdate = null;
    this.cacheDuration = 5 * 60 * 1000; // 5 minutes
    this.fallbackEnums = this.getFallbackEnums();
  }

  getFallbackEnums() {
    return {
      'gender': ['male', 'female', 'non-binary', 'other', 'prefer-not-to-say'],
      'religion': ['christian', 'muslim', 'hindu', 'buddhist', 'jewish', 'atheist', 'agnostic', 'other', 'prefer_not_to_say'],
      'servingAs': ['elder', 'ministerial_servant', 'pioneer', 'regular_publisher', 'other'],
      'relationshipStatus': ['single', 'dating', 'married', 'divorced', 'separated', 'complicated'],
      'lookingFor': ['friendship', 'dating', 'relationship', 'marriage', 'casual'],
      'haveChildren': ['yes', 'no', 'prefer_not_to_say'],
      'wantsChildren': ['yes', 'no', 'maybe', 'prefer_not_to_say'],
      'education': ['high_school', 'some_college', 'bachelors', 'masters', 'phd', 'other'],
      'income': ['under_30k', '30k_60k', '60k_100k', '100k_150k', '150k_plus', 'prefer_not_to_say'],
      'matchGender': ['male', 'female', 'non-binary', 'any'],
      'matchReligion': ['christian', 'muslim', 'hindu', 'buddhist', 'jewish', 'atheist', 'agnostic', 'other', 'prefer_not_to_say', 'any'],
      'matchEducationLevel': ['high_school', 'some_college', 'bachelors', 'masters', 'phd', 'other', 'any'],
      'matchWantsChildren': ['yes', 'no', 'maybe', 'any']
    };
  }

  async getAllOptions() {
    const now = Date.now();
    
    // Return cached data if still valid
    if (this.lastUpdate && (now - this.lastUpdate < this.cacheDuration)) {
      return this.cache;
    }
    
    try {
      // Fetch from database
      const options = await Option.find({ isActive: true }).sort({ category: 1, order: 1 });
      
      // Group by category
      const groupedOptions = {};
      options.forEach(option => {
        if (!groupedOptions[option.category]) {
          groupedOptions[option.category] = [];
        }
        groupedOptions[option.category].push({
          value: option.value,
          label: option.label,
          description: option.description,
          isDefault: option.isDefault
        });
      });
      
      // Update cache
      this.cache = groupedOptions;
      this.lastUpdate = now;
      
      return groupedOptions;
    } catch (error) {
      console.error('Error fetching options from database:', error);
      // Return empty object on error
      return {};
    }
  }

  async getOptionsByCategory(category) {
    try {
      const allOptions = await this.getAllOptions();
      return allOptions[category] || [];
    } catch (error) {
      console.error(`Error getting options for category ${category}:`, error);
      return [];
    }
  }

  async getOptionLabel(category, value) {
    try {
      const options = await this.getOptionsByCategory(category);
      const option = options.find(opt => opt.value === value);
      
      if (option) {
        return option.label;
      }
    } catch (error) {
      console.error(`Error getting label for ${category}=${value}:`, error);
    }
    
    // Fallback: return the value itself or check fallback labels
    return this.getFallbackLabel(category, value) || value;
  }

  getFallbackLabel(category, value) {
    const fallbackLabels = {
      'gender': {
        'male': 'Male',
        'female': 'Female',
        'non-binary': 'Non-binary',
        'other': 'Other',
        'prefer-not-to-say': 'Prefer not to say'
      },
      'relationshipStatus': {
        'single': 'Single',
        'dating': 'Dating',
        'married': 'Married',
        'divorced': 'Divorced',
        'separated': 'Separated',
        'complicated': "It's complicated"
      },
      'education': {
        'high_school': 'High School',
        'some_college': 'Some College',
        'bachelors': "Bachelor's Degree",
        'masters': "Master's Degree",
        'phd': 'PhD',
        'other': 'Other'
      }
      // Add more as needed
    };
    
    return fallbackLabels[category]?.[value];
  }

  async getDefaultValue(category) {
    try {
      const options = await this.getOptionsByCategory(category);
      const defaultOption = options.find(opt => opt.isDefault);
      return defaultOption ? defaultOption.value : null;
    } catch (error) {
      console.error(`Error getting default for category ${category}:`, error);
      return null;
    }
  }

  async validateOption(category, value) {
    try {
      const options = await this.getOptionsByCategory(category);
      
      // If we have options in database, check them
      if (options.length > 0) {
        const isValid = options.some(opt => opt.value === value);
        if (isValid) {
          return true;
        }
      }
      
      // If not found in database or no database options, use fallback
      console.log(`Using fallback validation for ${category}=${value}`);
      return this.fallbackValidation(category, value);
      
    } catch (error) {
      console.error(`Error validating option ${category}=${value}:`, error);
      // On error, use fallback
      return this.fallbackValidation(category, value);
    }
  }

  fallbackValidation(category, value) {
    const validValues = this.fallbackEnums[category];
    
    if (!validValues) {
      console.error(`No validation rules defined for category: ${category}`);
      // If we don't know the category, accept anything
      return true;
    }

    // Handle array values (like lookingFor which can be array)
    if (Array.isArray(value)) {
      return value.every(item => validValues.includes(item));
    }

    return validValues.includes(value);
  }

  // Clear cache (call this when admin updates options)
  clearCache() {
    this.cache.clear();
    this.lastUpdate = null;
  }
}

module.exports = new OptionService();