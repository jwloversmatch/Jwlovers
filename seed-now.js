// seed-now.js - JW-FOCUSED WITH MULTIPLE ANSWERS
require("dotenv").config();
require("module-alias/register");
const mongoose = require('mongoose');
const SecurityQuestion = require('@models/SecurityQuestion');

async function seedSecurityQuestions() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log('✅ Connected to MongoDB');
    
    // Check existing questions
    const count = await SecurityQuestion.countDocuments();
    
    if (count === 0) {
      console.log('🌱 No security questions found. Seeding DEEP JW knowledge questions...');
      
      const deepJwQuestions = [
        // Governing Body Members
        {
          questionId: "gb_members_001",
          questionText: "Name one current member of the Governing Body",
          acceptableAnswers: [
            "mark sanderson",
            "mark a. sanderson",
            "brother sanderson",
            "stephen lett",
            "gerrit lösch",
            "gerrit losch",
            "samuel herd",
            "kenneth cook",
            "david splane",
            "jeffrey jackson"
          ],
          category: "governing_body",
          difficulty: "medium",
          answerType: "name"
        },
        
        // JW History & Organization
        {
          questionId: "jw_history_001",
          questionText: "In what year was the name 'Jehovah's Witnesses' adopted?",
          acceptableAnswers: ["1931", "nineteen thirty-one", "1931 ad"],
          category: "jw_history",
          difficulty: "hard",
          answerType: "year"
        },
        {
          questionId: "jw_history_002",
          questionText: "Where is world headquarters located?",
          acceptableAnswers: ["warwick", "warwick new york", "warwick ny"],
          category: "jw_history",
          difficulty: "medium",
          answerType: "exact"
        },
        
        // Doctrinal Deep Knowledge
        {
          questionId: "doctrine_001",
          questionText: "What year marked the beginning of Christ's presence?",
          acceptableAnswers: ["1914", "nineteen fourteen"],
          category: "doctrine",
          difficulty: "medium",
          answerType: "year"
        },
        {
          questionId: "doctrine_002",
          questionText: "What is the meaning of the 'great crowd' in Revelation 7:9?",
          acceptableAnswers: ["other sheep", "the other sheep", "great multitude"],
          category: "doctrine",
          difficulty: "medium",
          answerType: "synonym"
        },
        
        // Scriptural Principles for Dating/Marriage
        {
          questionId: "dating_001",
          questionText: "What does 2 Corinthians 6:14 say about being unevenly yoked?",
          acceptableAnswers: [
            "do not become",
            "do not be",
            "do not become unequally yoked",
            "do not be yoked together",
            "do not become yoked with unbelievers"
          ],
          category: "dating_principles",
          difficulty: "medium",
          answerType: "contains"
        },
        {
          questionId: "dating_002",
          questionText: "According to 1 Corinthians 7:39, a widow is free to marry whom?",
          acceptableAnswers: ["only in the lord", "in the lord", "a believer"],
          category: "dating_principles",
          difficulty: "medium",
          answerType: "contains"
        },
        
        // JW Publications
        {
          questionId: "pubs_001",
          questionText: "What is the name of our main study publication?",
          acceptableAnswers: ["watchtower", "the watchtower", "watchtower magazine"],
          category: "publications",
          difficulty: "easy",
          answerType: "exact"
        },
        {
          questionId: "pubs_002",
          questionText: "What is the name of the children's publication?",
          acceptableAnswers: ["listen to god", "listen to god book", "listen book"],
          category: "publications",
          difficulty: "easy",
          answerType: "contains"
        },
        
        // Service & Ministry
        {
          questionId: "service_001",
          questionText: "How many hours is the pioneer requirement monthly?",
          acceptableAnswers: ["50", "fifty", "50 hours"],
          category: "service",
          difficulty: "easy",
          answerType: "numeric"
        },
        {
          questionId: "service_002",
          questionText: "What is the name of the online witnessing tool?",
          acceptableAnswers: ["jw broadcast", "jw broadcasting", "broadcast"],
          category: "service",
          difficulty: "easy",
          answerType: "contains"
        },
        
        // General JW Questions
        {
          questionId: "jw_general_001",
          questionText: "What is the name of our annual commemoration?",
          acceptableAnswers: ["memorial", "lord's evening meal", "memorial of christ's death"],
          category: "jw_general",
          difficulty: "easy",
          answerType: "synonym"
        },
        {
          questionId: "jw_general_002",
          questionText: "How many times a year do we have circuit assemblies?",
          acceptableAnswers: ["three", "3", "three times", "3 times"],
          category: "jw_general",
          difficulty: "medium",
          answerType: "numeric"
        }
      ];
      
      let successCount = 0;
      let errors = [];
      
      for (const q of deepJwQuestions) {
        try {
          // Use the new createQuestionWithAnswers method
          await SecurityQuestion.createQuestionWithAnswers({
            questionId: q.questionId,
            questionText: q.questionText,
            acceptableAnswers: q.acceptableAnswers,
            category: q.category,
            difficulty: q.difficulty,
            answerType: q.answerType,
            isActive: true
          });
          
          console.log(`✅ Created: ${q.questionId} with ${q.acceptableAnswers.length} acceptable variations`);
          successCount++;
          
        } catch (saveError) {
          const errorMsg = `Error saving question ${q.questionId}: ${saveError.message}`;
          console.error(`❌ ${errorMsg}`);
          errors.push(errorMsg);
        }
      }
      
      console.log(`\n📊 Seeding Summary:`);
      console.log(`🌱 Successfully seeded: ${successCount}/${deepJwQuestions.length} DEEP JW knowledge questions`);
      console.log(`📚 Categories:`);
      console.log(`   • Governing Body Members`);
      console.log(`   • JW History & Organization`);
      console.log(`   • Doctrinal Deep Knowledge`);
      console.log(`   • Scriptural Dating Principles`);
      console.log(`   • JW Publications`);
      console.log(`   • Service & Ministry`);
      console.log(`   • General JW Questions`);
      
      if (errors.length > 0) {
        console.log(`\n❌ Errors encountered:`);
        errors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error}`);
        });
      }
      
      if (successCount > 0) {
        console.log(`\n✨ ${successCount} DEEP JW knowledge questions are now available!`);
        console.log(`💑 Perfect for verifying spiritually mature JW singles!`);
        console.log(`📖 Multiple answer variations accepted for user-friendly experience.`);
      }
      
    } else {
      console.log(`✅ Found ${count} security questions already in database`);
      
      // Show existing questions
      const questions = await SecurityQuestion.find()
        .select('questionId questionText category difficulty isActive answerType')
        .sort('questionId');
      
      console.log(`\n📋 Existing security questions:`);
      questions.forEach((q, i) => {
        console.log(`  ${i + 1}. ${q.questionId}: "${q.questionText}"`);
        console.log(`     Category: ${q.category}, Difficulty: ${q.difficulty}, Type: ${q.answerType}, Active: ${q.isActive ? '✅' : '❌'}`);
      });
      
      console.log(`\n💡 To reseed with DEEP JW questions, first delete existing questions:`);
      console.log(`   Run: node delete-questions.js`);
    }
    
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
    console.log('✨ Seed operation completed!');
    
  } catch (error) {
    console.error('❌ Error seeding security questions:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the seed function
seedSecurityQuestions();