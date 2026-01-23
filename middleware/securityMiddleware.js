// middleware/securityMiddleware.js
const SecurityQuestionService = require("@services/securityquestion.service");

exports.verifyRegistration = async (req, res, next) => {
  console.log('[SECURITY MIDDLEWARE] verifyRegistration called');
  console.log('[SECURITY MIDDLEWARE] Body received:', req.body);
  console.log('[SECURITY MIDDLEWARE] Headers:', {
    authorization: req.headers.authorization ? 'Present' : 'Missing'
  });
  
  try {
    // Get token from multiple possible locations
    let verificationToken;
    let sessionId;
    
    // Option 1: From Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      verificationToken = req.headers.authorization.replace('Bearer ', '');
      console.log('[SECURITY MIDDLEWARE] Got token from Authorization header');
    }
    
    // Option 2: From body (check multiple possible field names)
    if (!verificationToken) {
      // Try different field names that might be used
      verificationToken = req.body.verificationToken || 
                         req.body.securityToken || 
                         req.body.token;
      
      if (verificationToken) {
        console.log('[SECURITY MIDDLEWARE] Got token from body field:', 
          req.body.verificationToken ? 'verificationToken' :
          req.body.securityToken ? 'securityToken' : 'token');
      }
    }
    
    // Get sessionId from body
    sessionId = req.body.sessionId;
    
    console.log('[SECURITY MIDDLEWARE] Verification token present?', !!verificationToken);
    console.log('[SECURITY MIDDLEWARE] Session ID present?', !!sessionId);
    console.log('[SECURITY MIDDLEWARE] Token length:', verificationToken ? verificationToken.length : 0);
    
    if (!verificationToken) {
      return res.status(400).json({
        success: false,
        message: "Verification token required. Provide token in Authorization header (Bearer token) or body (verificationToken, securityToken, or token field)",
        code: "VERIFICATION_REQUIRED",
      });
    }
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID required",
        code: "SESSION_ID_REQUIRED",
      });
    }
    
    // Verify the JWT token
    const jwt = require("jsonwebtoken");
    let decoded;
    
    console.log('[SECURITY MIDDLEWARE] Attempting to verify JWT token...');
    try {
      decoded = jwt.verify(
        verificationToken,
        process.env.VERIFICATION_SECRET || "your-verification-secret"
      );
      
      console.log('[SECURITY MIDDLEWARE] JWT decoded successfully:', {
        sessionId: decoded.sessionId,
        type: decoded.type,
        expires: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : 'No expiry'
      });
      
    } catch (error) {
      console.error('[SECURITY MIDDLEWARE] JWT verification failed:', error.name, error.message);
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: "Invalid verification token format",
          code: "INVALID_TOKEN_FORMAT",
        });
      }
      
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: "Verification token has expired. Please complete security verification again.",
          code: "TOKEN_EXPIRED",
        });
      }
      
      return res.status(401).json({
        success: false,
        message: "Invalid or expired verification token",
        code: "INVALID_VERIFICATION",
      });
    }
    
    // Verify token type
    if (decoded.type !== 'registration_verification') {
      console.log('[SECURITY MIDDLEWARE] Wrong token type:', decoded.type);
      return res.status(401).json({
        success: false,
        message: "Invalid token type. Expected 'registration_verification'",
        code: "INVALID_TOKEN_TYPE",
      });
    }
    
    // Verify session matches token
    if (decoded.sessionId !== sessionId) {
      console.log('[SECURITY MIDDLEWARE] Session ID mismatch. Token:', decoded.sessionId, 'Body:', sessionId);
      return res.status(401).json({
        success: false,
        message: "Session ID does not match verification token",
        code: "SESSION_MISMATCH",
      });
    }
    
    // Verify the session with SecurityQuestionService
    console.log('[SECURITY MIDDLEWARE] Verifying session with SecurityQuestionService...');
    const verification = await SecurityQuestionService.verifySessionForRegistration(
      sessionId,
      req
    );
    
    if (!verification.success) {
      console.log('[SECURITY MIDDLEWARE] Session verification failed:', verification.error);
      return res.status(401).json({
        success: false,
        message: verification.error,
        code: verification.code || "SESSION_VERIFICATION_FAILED",
      });
    }
    
    // Attach session to request
    req.verifiedSession = verification.session;
    console.log('[SECURITY MIDDLEWARE] ✅ Verification successful');
    next();
    
  } catch (error) {
    console.error("[SECURITY MIDDLEWARE] Verification error:", error);
    res.status(500).json({
      success: false,
      message: "Verification failed",
      code: "VERIFICATION_ERROR",
    });
  }
};

// Optional: Add a test endpoint
exports.testVerification = async (req, res) => {
  console.log('[SECURITY MIDDLEWARE TEST] Called');
  res.json({
    success: true,
    message: "Security middleware test endpoint",
    timestamp: new Date().toISOString()
  });
};