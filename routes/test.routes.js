// routes/test.routes.js
const express = require('express');
const router = express.Router();

// Test API Health Check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'test-api',
    status: 'operational',
    timestamp: new Date().toISOString(),
    endpoints: []
  });
});

// Test API routes will be added here

// Export as function for RouteLoader compatibility
module.exports = function(dependencies = {}) {
  // You can use dependencies here if needed
  // Example: const service = dependencies.testService;
  return router;
};

// Also export router directly for other uses
module.exports.router = router;