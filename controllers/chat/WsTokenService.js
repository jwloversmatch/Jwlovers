const crypto = require('crypto');

class WsTokenService {
  generateToken(userId) {
    const timestamp = Date.now();
    const expiresIn = 24 * 60 * 60 * 1000; 
    const expiresAt = timestamp + expiresIn;
    
    // Generate secure token using HMAC
    const secret = process.env.WS_SECRET || 'chat-secret-key-change-in-production';
    const data = `${userId}:${timestamp}:${expiresIn}`;
    const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
    const token = Buffer.from(`${data}:${signature}`).toString('base64');
    
    return {
      token,
      expiresAt,
      userId
    };
  }

  verifyToken(token) {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const [userId, timestamp, expiresIn, signature] = decoded.split(':');
      
      const secret = process.env.WS_SECRET || 'chat-secret-key-change-in-production';
      const expectedSignature = crypto.createHmac('sha256', secret)
        .update(`${userId}:${timestamp}:${expiresIn}`)
        .digest('hex');
      
      if (signature !== expectedSignature) {
        return { valid: false, error: 'Invalid signature' };
      }
      
      const now = Date.now();
      const tokenTimestamp = parseInt(timestamp);
      const tokenExpiresIn = parseInt(expiresIn);
      
      if (now > tokenTimestamp + tokenExpiresIn) {
        return { valid: false, error: 'Token expired' };
      }
      
      return { 
        valid: true, 
        userId,
        expiresAt: tokenTimestamp + tokenExpiresIn 
      };
      
    } catch (error) {
      return { valid: false, error: 'Invalid token format' };
    }
  }
}

module.exports = WsTokenService;