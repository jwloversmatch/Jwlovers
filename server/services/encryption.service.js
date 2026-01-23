const crypto = require("crypto");
const CONFIG = require("../config/constants");
const logger = require("../utils/logger");
const { ENCRYPTION_KEY } = require("../config/encryption");

class EncryptionService {
  static encryptMessage(text) {
    try {
      if (!text || typeof text !== "string") {
        throw new Error("Invalid message content");
      }

      if (text.length > CONFIG.VALIDATION.MAX_MESSAGE_LENGTH) {
        throw new Error(`Message too long (max ${CONFIG.VALIDATION.MAX_MESSAGE_LENGTH} characters)`);
      }

      if (text.length < CONFIG.VALIDATION.MIN_MESSAGE_LENGTH) {
        throw new Error("Message cannot be empty");
      }

      const iv = crypto.randomBytes(CONFIG.ENCRYPTION.IV_LENGTH);
      const cipher = crypto.createCipheriv(CONFIG.ENCRYPTION.ALGORITHM, ENCRYPTION_KEY, iv);

      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");
      const authTag = cipher.getAuthTag();

      const result = {
        iv: iv.toString("hex"),
        authTag: authTag.toString("hex"),
        content: encrypted,
        encryptedAt: new Date().toISOString(),
        version: 4,
        alg: CONFIG.ENCRYPTION.ALGORITHM
      };

      return JSON.stringify(result);
    } catch (error) {
      logger.error("Encryption error:", error);
      throw error;
    }
  }

  static decryptMessage(encryptedData) {
    try {
      const data = typeof encryptedData === "string" ? JSON.parse(encryptedData) : encryptedData;

      if (!data.iv || !data.authTag || !data.content) {
        throw new Error("Invalid encrypted data structure");
      }

      const iv = Buffer.from(data.iv, "hex");
      const authTag = Buffer.from(data.authTag, "hex");
      const encryptedText = data.content;

      const decipher = crypto.createDecipheriv(CONFIG.ENCRYPTION.ALGORITHM, ENCRYPTION_KEY, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedText, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      logger.error("Decryption error:", error);
      throw error;
    }
  }

  static isEncrypted(content) {
    if (!content) return false;
    try {
      const data = JSON.parse(content);
      return !!(data.iv && data.authTag && data.content && data.encryptedAt);
    } catch (error) {
      return false;
    }
  }

  static isLegacyCiphertext(content) {
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

  static encryptMessageForStorage(content) {
    const isAlreadyEncrypted = this.isEncrypted(content);
    const isLegacy = this.isLegacyCiphertext(content);

    if (isLegacy) {
      logger.warn("⚠️ Legacy ciphertext detected");
      
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
        logger.error("Failed to wrap legacy ciphertext:", error);
        return {
          content,
          encryptionType: "server-side",
          isEncrypted: true,
          isLegacy: true
        };
      }
    }

    if (!isAlreadyEncrypted && content) {
      return {
        content: this.encryptMessage(content),
        encryptionType: "server-side",
        isEncrypted: true,
        version: 4,
        alg: CONFIG.ENCRYPTION.ALGORITHM
      };
    }

    return {
      content,
      encryptionType: isAlreadyEncrypted ? "server-side" : "none",
      isEncrypted: isAlreadyEncrypted
    };
  }

  static decryptForFrontend(encryptedContent, encryptionType = "server-side") {
    if (!encryptedContent) return encryptedContent;
    if (encryptionType !== "server-side") return encryptedContent;

    try {
      const data = JSON.parse(encryptedContent);

      if (data.iv && data.authTag && data.content) {
        try {
          return this.decryptMessage(data);
        } catch (decryptError) {
          logger.warn("Failed to decrypt new format:", decryptError.message);
        }
      }

      if (data.migratedFrom) {
        logger.warn("Wrapped legacy content:", data.migratedFrom);
        return "🔒 [Encrypted message - requires migration]";
      }
    } catch (error) {
      logger.warn("Content is not JSON or cannot be parsed:", error.message);
    }

    return encryptedContent;
  }
}

module.exports = EncryptionService;