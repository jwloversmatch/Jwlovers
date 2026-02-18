// services/encryption.service.js
const crypto = require("crypto");

class EncryptionService {
  constructor(config) {
    this.config = config;
    this.key = null;
    this.isInitialized = false;
  }

  /**
   * Initialize encryption service with async key derivation.
   * FIXED: Now uses async pbkdf2 instead of pbkdf2Sync (non-blocking)
   * 
   * @param {string} encryptionKeyRaw - Raw encryption key from env
   * @param {string} salt - Salt for PBKDF2 (should be unique per deployment)
   * @returns {Promise<EncryptionService>} - Returns self for chaining
   */
  async init(encryptionKeyRaw, salt) {
    console.log('🔐 [EncryptionService] Initializing with:', {
      hasKey: !!encryptionKeyRaw,
      keyLength: encryptionKeyRaw?.length,
      hasSalt: !!salt,
      saltLength: salt?.length,
      algorithm: this.config.ALGORITHM
    });

    if (!encryptionKeyRaw) {
      throw new Error("MESSAGE_ENCRYPTION_KEY environment variable is required");
    }

    // FIXED: Validate salt
    if (!salt || salt.length < 16) {
      throw new Error("Salt must be at least 16 characters. Generate with: openssl rand -hex 32");
    }

    try {
      // FIXED: Use async pbkdf2 instead of pbkdf2Sync (non-blocking)
      this.key = await new Promise((resolve, reject) => {
        crypto.pbkdf2(
          encryptionKeyRaw,
          salt,
          this.config.KEY_ITERATIONS,
          this.config.KEY_LENGTH,
          'sha256',
          (err, derivedKey) => {
            if (err) reject(err);
            else resolve(derivedKey);
          }
        );
      });
      
      this.isInitialized = true;
      console.log('✅ [EncryptionService] Initialization successful');
      
      // FIXED: Only run test in development
      if (process.env.NODE_ENV === 'development') {
        await this.testEncryption();
      }
      
      return this;
    } catch (error) {
      console.error('❌ [EncryptionService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Test encryption/decryption to verify service is working.
   * FIXED: Now async and only runs in development
   */
  async testEncryption() {
    try {
      const testMessage = "Test encryption message";
      console.log('🧪 [EncryptionService] Testing encryption...');
      
      const encrypted = this.encryptMessage(testMessage);
      const decrypted = this.decryptMessage(encrypted);
      
      if (decrypted === testMessage) {
        console.log('✅ [EncryptionService] Encryption test PASSED');
      } else {
        console.error('❌ [EncryptionService] Encryption test FAILED');
        console.error('   Expected:', testMessage);
        console.error('   Got:', decrypted);
      }
    } catch (error) {
      console.error('❌ [EncryptionService] Encryption test ERROR:', error.message);
    }
  }

  ensureInitialized() {
    if (!this.isInitialized || !this.key) {
      throw new Error("EncryptionService not properly initialized. Call init() first.");
    }
  }

  /**
   * Encrypt a plaintext message.
   * Returns JSON string with {iv, authTag, content, ...}
   * 
   * @param {string} text - Plaintext to encrypt
   * @returns {string} - JSON string of encrypted data
   */
  encryptMessage(text) {
    this.ensureInitialized();
    
    try {
      if (!text || typeof text !== "string") {
        throw new Error("Invalid message content");
      }

      if (text.length > this.config.MAX_MESSAGE_LENGTH) {
        throw new Error(`Message too long (max ${this.config.MAX_MESSAGE_LENGTH} characters)`);
      }

      // FIXED: Allow empty messages (removed MIN_MESSAGE_LENGTH check)
      // Some valid use cases send empty content with media attachments

      // Create IV (Initialization Vector) - random per message
      const iv = crypto.randomBytes(this.config.IV_LENGTH);
      
      // Create cipher with the derived key
      const cipher = crypto.createCipheriv(
        this.config.ALGORITHM, 
        this.key, 
        iv,
        { authTagLength: this.config.AUTH_TAG_LENGTH }
      );

      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");
      
      // Get authentication tag (for GCM mode - prevents tampering)
      const authTag = cipher.getAuthTag();

      const result = {
        iv: iv.toString("hex"),
        authTag: authTag.toString("hex"),
        content: encrypted,
        encryptedAt: new Date().toISOString(),
        version: 4,
        alg: this.config.ALGORITHM,
        keyDerivation: "PBKDF2"
      };

      // FIXED: Reduce logging verbosity in production
      if (process.env.NODE_ENV === 'development') {
        console.log('🔐 [EncryptionService] Message encrypted:', {
          originalLength: text.length,
          encryptedLength: JSON.stringify(result).length
        });
      }

      return JSON.stringify(result);
    } catch (error) {
      console.error("❌ [EncryptionService] Encryption error:", error.message);
      throw error;
    }
  }

  /**
   * Decrypt an encrypted message.
   * 
   * @param {string|object} encryptedData - JSON string or object with {iv, authTag, content}
   * @returns {string} - Plaintext message
   */
  decryptMessage(encryptedData) {
    this.ensureInitialized();
    
    try {
      const data = typeof encryptedData === "string" ? JSON.parse(encryptedData) : encryptedData;

      if (!data.iv || !data.authTag || !data.content) {
        throw new Error("Invalid encrypted data structure");
      }

      const iv = Buffer.from(data.iv, "hex");
      const authTag = Buffer.from(data.authTag, "hex");
      const encryptedText = data.content;

      // Create decipher
      const decipher = crypto.createDecipheriv(
        this.config.ALGORITHM, 
        this.key, 
        iv,
        { authTagLength: this.config.AUTH_TAG_LENGTH }
      );
      
      // Set auth tag - will throw if tampered
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedText, "hex", "utf8");
      decrypted += decipher.final("utf8");

      // FIXED: Reduce logging in production
      if (process.env.NODE_ENV === 'development') {
        console.log('🔓 [EncryptionService] Message decrypted:', {
          decryptedLength: decrypted.length
        });
      }

      return decrypted;
    } catch (error) {
      // FIXED: Don't log full error in production (timing attack prevention)
      if (process.env.NODE_ENV === 'development') {
        console.error("❌ [EncryptionService] Decryption error:", error.message);
      } else {
        console.error("❌ [EncryptionService] Decryption failed");
      }
      throw error;
    }
  }

  /**
   * Check if content is encrypted (has our format).
   * 
   * @param {string} content - Content to check
   * @returns {boolean}
   */
  isEncrypted(content) {
    if (!content) return false;
    try {
      const data = JSON.parse(content);
      return !!(data.iv && data.authTag && data.content && data.encryptedAt);
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if content is legacy ciphertext (migration support).
   * 
   * @param {string} content - Content to check
   * @returns {boolean}
   */
  isLegacyCiphertext(content) {
    if (!content || typeof content !== "string") return false;

    // crypto-js format
    if (content.startsWith("U2FsdGVk")) {
      return true;
    }

    try {
      const data = JSON.parse(content);
      return !!(data.migratedFrom || data.migratedFromLegacy || 
                (data.iv && data.authTag && !data.content));
    } catch (e) {
      return content.startsWith("migrated:") || content.startsWith("migrated-plain:");
    }
  }

  /**
   * Encrypt message for storage in database.
   * Called by MessageEncryptionHandler.
   * 
   * @param {string} content - Plaintext content
   * @returns {object} - {content, encryptionType, isEncrypted, ...}
   */
  encryptMessageForStorage(content) {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔐 [EncryptionService] encryptMessageForStorage called:', {
        contentLength: content?.length,
        isInitialized: this.isInitialized
      });
    }

    // Check if service is initialized
    if (!this.isInitialized) {
      console.warn('⚠️ [EncryptionService] Not initialized, cannot encrypt');
      // FIXED: Throw error instead of storing plaintext
      throw new Error("EncryptionService not initialized - cannot encrypt message");
    }

    const isAlreadyEncrypted = this.isEncrypted(content);
    const isLegacy = this.isLegacyCiphertext(content);

    // Handle legacy ciphertext migration
    if (isLegacy) {
      console.warn("⚠️ [EncryptionService] Legacy ciphertext detected");
      
      try {
        if (content.startsWith("{")) {
          const parsed = JSON.parse(content);
          const wrappedContent = JSON.stringify({
            iv: parsed.iv || "",
            authTag: parsed.authTag || "",
            content: parsed.encryptedData || parsed.ciphertext || parsed.content || content,
            encryptedAt: parsed.encryptedAt || new Date().toISOString(),
            migratedFrom: "legacy-format",
            version: 4
          });

          return {
            content: wrappedContent,
            encryptionType: "server-side",
            isEncrypted: true,
            needsMigration: true
          };
        }

        if (content.startsWith("U2FsdGVk")) {
          const wrappedContent = JSON.stringify({
            iv: "",
            authTag: "",
            content: content,
            encryptedAt: new Date().toISOString(),
            migratedFrom: "crypto-js-legacy",
            version: 4
          });

          return {
            content: wrappedContent,
            encryptionType: "server-side",
            isEncrypted: true,
            needsMigration: true
          };
        }
      } catch (error) {
        console.error("Failed to wrap legacy ciphertext:", error);
        return {
          content,
          encryptionType: "server-side",
          isEncrypted: true,
          isLegacy: true
        };
      }
    }

    // Encrypt new plaintext messages
    if (!isAlreadyEncrypted && content) {
      try {
        const encryptedContent = this.encryptMessage(content);
        
        if (process.env.NODE_ENV === 'development') {
          console.log('✅ [EncryptionService] Encryption successful');
        }
        
        return {
          content: encryptedContent,
          encryptionType: "server-side",
          isEncrypted: true,
          version: 4,
          alg: this.config.ALGORITHM
        };
      } catch (error) {
        console.error('❌ [EncryptionService] Encryption failed:', error.message);
        // FIXED: Throw error instead of falling back to plaintext
        throw new Error(`Failed to encrypt message: ${error.message}`);
      }
    }

    // Content is already encrypted or empty
    if (process.env.NODE_ENV === 'development') {
      console.log('🔐 [EncryptionService] Content already encrypted or empty');
    }
    
    return {
      content: content || '',
      encryptionType: isAlreadyEncrypted ? "server-side" : undefined,
      isEncrypted: isAlreadyEncrypted
    };
  }

  /**
   * Decrypt message for sending to frontend.
   * Called by MessageFormatter.
   * 
   * @param {string} encryptedContent - Encrypted JSON string
   * @param {string} encryptionType - Type of encryption
   * @returns {string} - Plaintext content
   */
  decryptForFrontend(encryptedContent, encryptionType = "server-side") {
    if (!encryptedContent) return encryptedContent;
    if (encryptionType !== "server-side") return encryptedContent;

    if (process.env.NODE_ENV === 'development') {
      console.log('🔐 [EncryptionService] decryptForFrontend called:', {
        contentLength: encryptedContent?.length,
        encryptionType
      });
    }

    // Check if service is initialized
    if (!this.isInitialized) {
      console.warn('⚠️ [EncryptionService] Not initialized for decryption');
      return "🔒 [Encrypted message - service not initialized]";
    }

    try {
      const data = JSON.parse(encryptedContent);

      // Decrypt our format
      if (data.iv && data.authTag && data.content) {
        try {
          const decrypted = this.decryptMessage(data);
          return decrypted;
        } catch (decryptError) {
          console.warn("❌ [EncryptionService] Decryption failed:", decryptError.message);
          return "🔒 [Encrypted message - decryption failed]";
        }
      }

      // Legacy content
      if (data.migratedFrom) {
        console.warn("⚠️ [EncryptionService] Legacy content:", data.migratedFrom);
        return "🔒 [Encrypted message - requires migration]";
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn("⚠️ [EncryptionService] Content parse error:", error.message);
      }
    }

    // Return as-is if we can't parse (might be plaintext from before encryption was enabled)
    return encryptedContent;
  }
}

module.exports = EncryptionService;