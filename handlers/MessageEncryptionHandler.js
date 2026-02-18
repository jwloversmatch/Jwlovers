// handlers/MessageEncryptionHandler.js - FIXED
const CONFIG = require("@config/constant");

class MessageEncryptionHandler {
  async encryptMessageForStorage(content) {
    console.log('🔐 [MessageEncryptionHandler] Starting encryption process...');
    
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
        console.error('❌ [MessageEncryptionHandler] NO ENCRYPTION KEY IN ENVIRONMENT!');
        throw new Error('MESSAGE_ENCRYPTION_KEY environment variable is required');
      }
      
      console.log('🔐 [MessageEncryptionHandler] Initializing EncryptionService...');
      const encryptionService = new EncryptionService(CONFIG.ENCRYPTION);
      
      // 🔥 CRITICAL FIX: AWAIT the async init() method
      await encryptionService.init(ENCRYPTION_KEY_RAW, encryptionSalt);
      
      console.log('🔐 [MessageEncryptionHandler] Encrypting content...');
      const result = encryptionService.encryptMessageForStorage(content);
      
      console.log('🔐 [MessageEncryptionHandler] Encryption result:', {
        isEncrypted: result.isEncrypted,
        encryptionType: result.encryptionType,
        originalLength: content.length,
        encryptedLength: result.content?.length,
      });
      
      if (!result.isEncrypted) {
        console.error('❌ [MessageEncryptionHandler] ENCRYPTION FAILED!');
        throw new Error('Encryption failed: ' + (result.encryptionError || 'Unknown error'));
      }
      
      console.log('✅ [MessageEncryptionHandler] SUCCESS - Message encrypted!');
      return result;
      
    } catch (error) {
      console.error('❌ [MessageEncryptionHandler] CRITICAL ERROR:', error);
      throw new Error(`Message encryption failed: ${error.message}. Message not saved.`);
    }
  }
  
  // Optional: Add decryption method for completeness
  async decryptForFrontend(encryptedContent, encryptionType = 'server-side') {
    if (!encryptedContent || encryptionType !== 'server-side') {
      return encryptedContent;
    }
    
    try {
      const EncryptionService = require('@services/encryption.service');
      
      const ENCRYPTION_KEY_RAW = process.env.MESSAGE_ENCRYPTION_KEY;
      const encryptionSalt = process.env.ENCRYPTION_SALT || CONFIG.ENCRYPTION.SALT;
      
      if (!ENCRYPTION_KEY_RAW) {
        console.error('❌ [MessageEncryptionHandler] NO ENCRYPTION KEY FOR DECRYPTION!');
        return '🔒 [Encrypted message - key not available]';
      }
      
      const encryptionService = new EncryptionService(CONFIG.ENCRYPTION);
      await encryptionService.init(ENCRYPTION_KEY_RAW, encryptionSalt);
      
      return encryptionService.decryptForFrontend(encryptedContent, encryptionType);
      
    } catch (error) {
      console.error('❌ [MessageEncryptionHandler] Decryption error:', error);
      return '🔒 [Encrypted message - decryption failed]';
    }
  }
}

module.exports = new MessageEncryptionHandler();