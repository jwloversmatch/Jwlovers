// services/answerValidation.service.js
const natural = require('natural'); // npm install natural
const stringSimilarity = require('string-similarity'); // npm install string-similarity

class AnswerValidationService {
  static normalizeAnswer(answer) {
    return answer.toLowerCase()
      .trim()
      .replace(/[.,!?;:'"]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\b(?:brother|sister|br|sr|mr|mrs|ms|dr)\b/gi, '')
      .replace(/\b(?:the|a|an|and|or|but|in|on|at|by|for|with|about|against|between|into|through|during|before|after|above|below|to|from|up|down|of|off|over|under)\b/gi, '')
      .trim();
  }

  static getAnswerSimilarity(answer1, answer2) {
    const normalized1 = this.normalizeAnswer(answer1);
    const normalized2 = this.normalizeAnswer(answer2);
    
    // Use string similarity
    const similarity = stringSimilarity.compareTwoStrings(normalized1, normalized2);
    
    // Also check for contains
    const contains = normalized1.includes(normalized2) || normalized2.includes(normalized1);
    
    return {
      similarity,
      contains,
      isMatch: similarity > 0.8 || contains
    };
  }

  static validateJWAnswer(userAnswer, correctAnswers) {
    if (!correctAnswers || correctAnswers.length === 0) {
      return { valid: false, score: 0, matched: null };
    }
    
    const normalizedUser = this.normalizeAnswer(userAnswer);
    
    // Check exact matches first
    for (const correct of correctAnswers) {
      const normalizedCorrect = this.normalizeAnswer(correct);
      
      if (normalizedUser === normalizedCorrect) {
        return { valid: true, score: 1.0, matched: correct };
      }
    }
    
    // Check similarity
    let bestMatch = { valid: false, score: 0, matched: null };
    
    for (const correct of correctAnswers) {
      const result = this.getAnswerSimilarity(userAnswer, correct);
      
      if (result.similarity > bestMatch.score) {
        bestMatch = {
          valid: result.similarity > 0.7, // 70% similarity threshold
          score: result.similarity,
          matched: correct
        };
      }
    }
    
    return bestMatch;
  }

  // JW-specific validation rules
  static validateJWYear(answer, correctYear) {
    const normalized = this.normalizeAnswer(answer);
    const yearRegex = /\b(19\d{2}|20\d{2})\b/;
    const match = normalized.match(yearRegex);
    
    if (match) {
      return match[0] === correctYear;
    }
    
    // Check written year
    const writtenYears = {
      "nineteen fourteen": "1914",
      "nineteen thirty-one": "1931",
      "nineteen thirty five": "1935",
      "nineteen seventy one": "1971",
      "nineteen fifty": "1950"
    };
    
    if (writtenYears[normalized]) {
      return writtenYears[normalized] === correctYear;
    }
    
    return false;
  }

  static validateScriptureReference(answer, correctReference) {
    const normalized = this.normalizeAnswer(answer);
    const simplifiedRef = correctReference.toLowerCase().replace(/[.:]/g, '');
    
    // Extract numbers from answer
    const numbers = normalized.match(/\d+/g);
    if (!numbers) return false;
    
    // Simple validation: check if contains the chapter and verse numbers
    return normalized.includes(simplifiedRef.replace(' ', ''));
  }
}

module.exports = AnswerValidationService;