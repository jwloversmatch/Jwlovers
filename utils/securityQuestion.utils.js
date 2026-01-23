// utils/securityQuestion.utils.js
const bcrypt = require('bcryptjs');

async function hashAnswer(answer) {
  const saltRounds = 12;
  return await bcrypt.hash(String(answer).toLowerCase().trim(), saltRounds);
}

module.exports = {
  hashAnswer
};