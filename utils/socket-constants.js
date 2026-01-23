module.exports = {
  EVENTS: {
    USER_ONLINE: 'user:online',
    USER_OFFLINE: 'user:offline',
    USER_STATUS_UPDATE: 'user:status-update',
    USER_TYPING: 'user:typing',
    NEW_MESSAGE: 'new_message',
    MESSAGES_READ: 'messages:read',
    JOINED_CONVERSATION: 'joined_conversation',
    OFFLINE_MESSAGES: 'offline_messages',
    ONLINE_USERS: 'users:online',
    PRESENCE_PERSONAL_UPDATE: 'presence:personal-update',
    ERROR: 'error',
    CONNECTION_ACK: 'connection:ack'
  },
  
  ROOMS: {
    USER_PREFIX: 'user_',
    CONVERSATION_PREFIX: 'conversation_'
  },
  
  RATE_LIMIT_KEYS: {
    MESSAGE_SEND: 'message:send',
    TYPING: 'typing',
    CONNECTION: 'connection'
  },
  
  MESSAGE_TYPES: {
    TEXT: 'text',
    IMAGE: 'image',
    VIDEO: 'video',
    FILE: 'file',
    AUDIO: 'audio'
  },
  
  USER_STATUS: {
    ONLINE: 'online',
    AWAY: 'away',
    BUSY: 'busy',
    OFFLINE: 'offline',
    DND: 'dnd'
  }
};