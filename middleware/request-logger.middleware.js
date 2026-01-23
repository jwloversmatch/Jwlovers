const requestLogger = (service = 'api') => (req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  // Log request
  console.log(`[${service}] ${requestId} ${req.method} ${req.path} - IP: ${req.ip}`);
  
  // Capture original send method
  const originalSend = res.send;
  
  res.send = function(body) {
    const duration = Date.now() - start;
    
    // Log response
    console.log(`[${service}] ${requestId} ${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
    
    // Add request ID to response headers
    res.setHeader('X-Request-ID', requestId);
    
    return originalSend.call(this, body);
  };
  
  next();
};

module.exports = requestLogger;