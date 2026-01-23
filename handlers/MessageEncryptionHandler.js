// handlers/MessageEncryptionHandler.js
const CONFIG = require("@config/constant");

class MessageEncryptionHandler {
  async encryptMessageForStorage(content) {
    console.log('🔐 [ENCRYPTION] Starting encryption process...');
    
    if (!content) {
      return { 
        content: '', 
        encryptionType: undefined,
        isEncrypted: false 
      };
    }
    
    try {
      const EncryptionService = require('@services/encryption.service');
      
      const ENCRYPTION_KEY_RAW = process.env.MESSAGE_ENCRYPTION_KEY;
      const encryptionSalt = process.env.ENCRYPTION_SALT || CONFIG.ENCRYPTION.SALT;
      
      if (!ENCRYPTION_KEY_RAW) {
        console.error('❌ [ENCRYPTION] NO ENCRYPTION KEY IN ENVIRONMENT!');
        throw new Error('MESSAGE_ENCRYPTION_KEY environment variable is required');
      }
      
      const encryptionService = new EncryptionService(CONFIG.ENCRYPTION);
      encryptionService.init(ENCRYPTION_KEY_RAW, encryptionSalt);
      
      console.log('🔐 [ENCRYPTION] Encrypting content...');
      const result = encryptionService.encryptMessageForStorage(content);
      
      console.log('🔐 [ENCRYPTION] Encryption result:', {
        isEncrypted: result.isEncrypted,
        encryptionType: result.encryptionType,
        originalLength: content.length,
        encryptedLength: result.content?.length,
      });
      
      if (!result.isEncrypted) {
        console.error('❌ [ENCRYPTION] ENCRYPTION FAILED!');
        throw new Error('Encryption failed: ' + (result.encryptionError || 'Unknown error'));
      }
      
      console.log('✅ [ENCRYPTION] SUCCESS - Message encrypted!');
      return result;
      
    } catch (error) {
      console.error('❌ [ENCRYPTION] CRITICAL ERROR:', error);
      throw new Error(`Message encryption failed: ${error.message}. Message not saved.`);
    }
  }
}

module.exports = new MessageEncryptionHandler();