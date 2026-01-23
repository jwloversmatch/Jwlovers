// services/encryption.service.js
const crypto = require("crypto");

class EncryptionService {
  constructor(config) {
    this.config = config;
    this.key = null;
    this.isInitialized = false;
  }

  init(encryptionKeyRaw, salt) {
    console.log('🔐 [EncryptionService] Initializing with:', {
      hasKey: !!encryptionKeyRaw,
      keyLength: encryptionKeyRaw?.length,
      algorithm: this.config.ALGORITHM
    });

    if (!encryptionKeyRaw) {
      throw new Error("MESSAGE_ENCRYPTION_KEY environment variable is required");
    }

    try {
      // Derive the key using PBKDF2
      this.key = crypto.pbkdf2Sync(
        encryptionKeyRaw,
        salt,
        this.config.KEY_ITERATIONS,
        this.config.KEY_LENGTH,
        'sha256'
      );
      
      this.isInitialized = true;
      console.log('✅ [EncryptionService] Initialization successful');
      
      // Test encryption/decryption
      this.testEncryption();
      
      return this;
    } catch (error) {
      console.error('❌ [EncryptionService] Initialization failed:', error);
      throw error;
    }
  }

  testEncryption() {
    try {
      const testMessage = "Test encryption message";
      console.log('🧪 [EncryptionService] Testing encryption...');
      
      const encrypted = this.encryptMessage(testMessage);
      const decrypted = this.decryptMessage(encrypted);
      
      if (decrypted === testMessage) {
        console.log('✅ [EncryptionService] Encryption test PASSED');
      } else {
        console.error('❌ [EncryptionService] Encryption test FAILED');
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

  encryptMessage(text) {
    this.ensureInitialized();
    
    try {
      if (!text || typeof text !== "string") {
        throw new Error("Invalid message content");
      }

      if (text.length > this.config.MAX_MESSAGE_LENGTH) {
        throw new Error(`Message too long (max ${this.config.MAX_MESSAGE_LENGTH} characters)`);
      }

      if (text.length < this.config.MIN_MESSAGE_LENGTH) {
        throw new Error("Message cannot be empty");
      }

      // Create IV (Initialization Vector)
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
      
      // Get authentication tag (for GCM mode)
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

      console.log('🔐 [EncryptionService] Message encrypted successfully:', {
        originalLength: text.length,
        encryptedLength: JSON.stringify(result).length
      });

      return JSON.stringify(result);
    } catch (error) {
      console.error("❌ [EncryptionService] Encryption error:", error);
      throw error;
    }
  }

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
      
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedText, "hex", "utf8");
      decrypted += decipher.final("utf8");

      console.log('🔓 [EncryptionService] Message decrypted successfully:', {
        decryptedLength: decrypted.length
      });

      return decrypted;
    } catch (error) {
      console.error("❌ [EncryptionService] Decryption error:", error);
      throw error;
    }
  }

  isEncrypted(content) {
    if (!content) return false;
    try {
      const data = JSON.parse(content);
      return !!(data.iv && data.authTag && data.content && data.encryptedAt);
    } catch (error) {
      return false;
    }
  }

  isLegacyCiphertext(content) {
    if (!content || typeof content !== "string") return false;

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

  encryptMessageForStorage(content) {
    console.log('🔐 [EncryptionService] encryptMessageForStorage called with:', {
      contentLength: content?.length,
      contentPreview: content?.substring(0, 50),
      isInitialized: this.isInitialized
    });

    // Check if service is initialized
    if (!this.isInitialized) {
      console.warn('⚠️ [EncryptionService] Not initialized, storing as plaintext');
      return {
        content: content || '',
        encryptionType: undefined,
        isEncrypted: false,
        error: "Service not initialized"
      };
    }

    const isAlreadyEncrypted = this.isEncrypted(content);
    const isLegacy = this.isLegacyCiphertext(content);

    if (isLegacy) {
      console.warn("⚠️ Legacy ciphertext detected");
      
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

    if (!isAlreadyEncrypted && content) {
      console.log('🔐 [EncryptionService] Encrypting new message...');
      try {
        const encryptedContent = this.encryptMessage(content);
        console.log('✅ [EncryptionService] Encryption successful:', {
          originalLength: content.length,
          encryptedLength: encryptedContent.length
        });
        
        return {
          content: encryptedContent,
          encryptionType: "server-side",
          isEncrypted: true,
          version: 4,
          alg: this.config.ALGORITHM
        };
      } catch (error) {
        console.error('❌ [EncryptionService] Encryption failed:', error);
        // Fallback: store as plaintext with warning
        return {
          content: content,
          encryptionType: undefined,
          isEncrypted: false,
          encryptionError: error.message
        };
      }
    }

    console.log('🔐 [EncryptionService] Content already encrypted or empty');
    return {
      content,
      encryptionType: isAlreadyEncrypted ? "server-side" : undefined,
      isEncrypted: isAlreadyEncrypted
    };
  }

  decryptForFrontend(encryptedContent, encryptionType = "server-side") {
    if (!encryptedContent) return encryptedContent;
    if (encryptionType !== "server-side") return encryptedContent;

    console.log('🔐 [EncryptionService] decryptForFrontend called with:', {
      contentLength: encryptedContent?.length,
      encryptionType
    });

    // Check if service is initialized
    if (!this.isInitialized) {
      console.warn('⚠️ [EncryptionService] Not initialized, returning placeholder');
      return "🔒 [Encrypted message - service not initialized]";
    }

    try {
      const data = JSON.parse(encryptedContent);

      if (data.iv && data.authTag && data.content) {
        try {
          const decrypted = this.decryptMessage(data);
          console.log('✅ [EncryptionService] Decryption successful');
          return decrypted;
        } catch (decryptError) {
          console.warn("❌ [EncryptionService] Failed to decrypt new format:", decryptError.message);
          return "🔒 [Encrypted message - decryption failed]";
        }
      }

      if (data.migratedFrom) {
        console.warn("⚠️ [EncryptionService] Wrapped legacy content:", data.migratedFrom);
        return "🔒 [Encrypted message - requires migration]";
      }
    } catch (error) {
      console.warn("⚠️ [EncryptionService] Content is not JSON or cannot be parsed:", error.message);
    }

    return encryptedContent;
  }
}

module.exports = EncryptionService;