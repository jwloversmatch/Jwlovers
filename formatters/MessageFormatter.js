// formatters/MessageFormatter.js
const logger = require('@utils/logger') || console;

function getEncryptionService(req) {
  try {
    return req?.app?.get?.('EncryptionService') ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect whether content is our AES-256-GCM encrypted JSON blob.
 * The DB stores encryption metadata in message.encryption.version ("v2")
 * but does NOT set message.encryptionType or message.isEncrypted on older docs.
 * So we detect by content shape, not by metadata fields.
 */
function isEncryptedJson(content) {
  if (!content || typeof content !== 'string' || !content.startsWith('{')) {
    return false;
  }
  try {
    const parsed = JSON.parse(content);
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof parsed.iv === 'string' &&
      typeof parsed.authTag === 'string' &&
      typeof parsed.content === 'string'
      // alg may or may not be present depending on version
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the effective encryptionType for a message document.
 * 
 * ROOT CAUSE OF ISSUE 1:
 *   DB stores: message.encryption = { version: "v2", keyId: "default" }
 *   But:       message.encryptionType = undefined
 *              message.isEncrypted    = undefined
 *   Old code:  encryptionType = encryption?.encryptionType ?? encryptionType ?? (isEncrypted ? 'server-side' : 'none')
 *              → resolves to 'none' → decryptContent() skips decryption ❌
 *
 * FIX: fall back to content-shape detection when metadata fields are missing.
 */
function resolveEncryptionType(message) {
  // 1. Explicit field on document (newer messages may have this)
  if (message.encryptionType && message.encryptionType !== 'none') {
    return message.encryptionType;
  }
  // 2. Nested encryption object (what the DB actually stores)
  if (message.encryption?.encryptionType) {
    return message.encryption.encryptionType;
  }
  // 3. isEncrypted flag
  if (message.isEncrypted) {
    return 'server-side';
  }
  // 4. encryption.version present → was encrypted at save time
  if (message.encryption?.version) {
    return 'server-side';
  }
  // 5. Last resort: parse the content and check its shape
  if (isEncryptedJson(message.content)) {
    return 'server-side';
  }
  return 'none';
}

function decryptContent(req, content, encryptionType) {
  if (!content) return content;

  // Only attempt decryption for server-side encrypted content
  if (encryptionType !== 'server-side') {
    return content;
  }

  // Must look like our encrypted JSON
  if (!isEncryptedJson(content)) {
    return content;
  }

  try {
    const encryptionService = getEncryptionService(req);
    if (!encryptionService) {
      logger.warn('[MessageFormatter] EncryptionService not available — returning placeholder');
      return '[Encrypted message]';
    }

    const decrypted = encryptionService.decryptForFrontend(content, encryptionType);
    return decrypted ?? content;
  } catch (err) {
    logger.warn('[MessageFormatter] decryptContent error:', err.message);
    return content;
  }
}

function formatSocketMessage(req, message, currentUserId) {
  if (!message) return message;

  // FIX: use resolveEncryptionType — handles missing encryptionType/isEncrypted fields
  const encryptionType = resolveEncryptionType(message);
  const decryptedContent = decryptContent(req, message.content, encryptionType);

  return {
    _id:             message._id,
    id:              message._id,
    content:         decryptedContent,
    type:            message.type || 'text',
    senderId:        message.senderId?._id ?? message.senderId,
    senderName:      getSenderName(message.senderId),
    senderUserName:  message.senderId?.userName ?? '',
    senderAvatar:    message.senderId?.avatar ?? null,
    receiverId:      message.receiverId?._id ?? message.receiverId,
    conversationId:  message.conversationId,
    status:          message.status ?? 'sent',
    clientMessageId: message.clientMessageId,
    createdAt:       message.createdAt,
    updatedAt:       message.updatedAt,
    readAt:          message.readAt ?? null,
    deliveredAt:     message.deliveredAt ?? null,
    isEdited:        message.isEdited ?? false,
    editedAt:        message.editedAt ?? null,
    mediaUrl:        message.mediaUrl ?? null,
    reactions:       message.reactions ?? [],
    isEncrypted:     false, // frontend always receives plaintext
    duplicate:       message.duplicate ?? false,
  };
}

function decryptMessageList(req, messages, currentUserId) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(msg => {
    try {
      return formatSocketMessage(req, msg, currentUserId);
    } catch (err) {
      logger.error('[MessageFormatter] Error formatting message:', err.message, msg?._id);
      return msg;
    }
  });
}

function decryptConversationMessages(req, conversations, currentUserId) {
  if (!Array.isArray(conversations)) return conversations;

  return conversations.map(conv => {
    try {
      if (!conv.lastMessage) return conv;

      const lastMessage = conv.lastMessage;
      // FIX: same resolveEncryptionType logic for lastMessage
      const encryptionType = resolveEncryptionType(lastMessage);

      return {
        ...conv,
        lastMessage: {
          ...lastMessage,
          content:     decryptContent(req, lastMessage.content, encryptionType),
          isEncrypted: false,
        },
      };
    } catch (err) {
      logger.error('[MessageFormatter] Error decrypting conversation lastMessage:', err.message, conv?._id);
      return conv;
    }
  });
}

function decryptSingleMessage(req, content, encryptionType = 'server-side') {
  return decryptContent(req, content, encryptionType);
}

function getSenderName(sender) {
  if (!sender) return 'Unknown';
  if (typeof sender === 'string') return 'User'; // just an ID
  if (sender.userName?.trim()) return sender.userName.trim();
  if (sender.fullName?.trim()) return sender.fullName.trim();
  if (sender.firstName || sender.lastName) {
    return [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim();
  }
  if (sender.email) return sender.email.split('@')[0];
  return 'User';
}

module.exports = {
  formatSocketMessage,
  decryptMessageList,
  decryptConversationMessages,
  decryptSingleMessage,
};