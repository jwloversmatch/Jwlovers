// // Core interfaces

// const RateLimitMetrics = {
//   redisHits: 0,
//   memoryFallbacks: 0,
//   errors: 0,
//   lastFallbackTime: null,
//   memoryStoreSize: 0,
//   circuitBreaker: null,
//   redisStatus: ""
// };

// const RateLimitStore = {
//   increment: async (key, windowMs, opts) => {
//     return {
//       totalHits: 0,
//       resetTime: new Date()
//     };
//   },
//   getMetrics: () => RateLimitMetrics,
//   clearMemoryStore: () => {},
//   resetRedisConnection: async () => {}
// };

// const RedisCircuitBreakerStats = {
//   totalRequests: 0,
//   failedRequests: 0,
//   stateTransitions: 0,
//   state: "",
//   failureCount: 0,
//   isOpen: false,
//   uptime: null
// };

// const RateLimitInfo = {
//   totalHits: 0,
//   limit: 0,
//   remaining: 0,
//   resetTime: new Date(),
//   timeUntilReset: 0,
//   isExceeded: false
// };

// const DynamicRateLimiterOptions = {
//   windowMs: 60000,
//   max: 100,
//   keyGenerator: (req) => req.ip || "",
//   message: "Too many requests, please try again later.",
//   skip: (req) => false,
//   skipSuccessfulRequests: false,
//   blockDuration: 0
// };

// const SocketWithRateLimit = {
//   user: { id: "" },
//   rateLimit: {
//     user: {
//       current: 0,
//       limit: 0,
//       remaining: 0,
//       reset: 0
//     },
//     ip: {
//       current: 0,
//       limit: 0,
//       remaining: 0
//     }
//   }
// };

// // Export all interfaces as a single object
// module.exports = {
//   RateLimitMetrics,
//   RateLimitStore,
//   RedisCircuitBreakerStats,
//   RateLimitInfo,
//   DynamicRateLimiterOptions,
//   SocketWithRateLimit
// };

// // Note: The "declare module" statement for Express Request extension
// // cannot be directly converted to CommonJS. This is a Type-specific
// // declaration that should remain in a .d.ts file or be handled differently.

// // If you need to extend Express Request in JavaScript, you would typically
// // use middleware to add properties to the request object:
// // 
// // app.use((req, res, next) => {
// //   req.rateLimit = req.rateLimit || {};
// //   req.user = req.user || {};
// //   next();
// // });