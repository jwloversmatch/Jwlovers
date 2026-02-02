// // Main export file - puts everything together
// import { RedisCircuitBreaker } from "./circuitBreaker";
// import { createEnhancedRedisStore } from "./store";
// import { RATE_LIMIT_CONFIG, getRateLimitConfig } from "./config";
// import { shouldSkipRateLimit } from "./handlers";
// import { createLimiters, createDynamicRateLimiter } from "./limiters";
// import { createTypedRateLimiter, rateLimitInfoMiddleware } from "./middleware";
// import { createSocketRateLimiter } from "./socketLimiter";
// import { createStoreFactory, createRateLimitUtilities } from "./utilities";
// import { ipKeyGenerator } from "express-rate-limit";

// // Initialize circuit breaker
// const redisCircuitBreaker = new RedisCircuitBreaker();

// // Create store factory
// const { createStore } = createStoreFactory(redisCircuitBreaker, createEnhancedRedisStore);

// // Create store instance
// const rateLimitStore = createStore();

// // Create all limiters
// const {
//   apiLimiter,
//   authLimiter,
//   messageLimiter,
//   registrationLimiter,
//   uploadLimiter,
//   searchLimiter,
//   profileViewLimiter,
//   passwordResetLimiter,
//   emailResendLimiter,
//   profileUpdateLimiter,
// } = createLimiters(rateLimitStore);

// // Create socket rate limiter
// const socketRateLimit = createSocketRateLimiter(redisCircuitBreaker);

// // Create utilities
// const {
//   resetRateLimit,
//   getRateLimitInfo,
//   getRateLimitMetrics,
//   resetCircuitBreaker,
//   clearMemoryStore,
//   getRateLimitHealth,
// } = createRateLimitUtilities(redisCircuitBreaker, rateLimitStore);

// // Export everything
// export {
//   // Rate limiter instances
//   apiLimiter,
//   authLimiter,
//   messageLimiter,
//   registrationLimiter,
//   uploadLimiter,
//   searchLimiter,
//   profileViewLimiter,
//   passwordResetLimiter,
//   emailResendLimiter,
//   profileUpdateLimiter,

//   // Socket rate limiting
//   socketRateLimit,

//   // Factory functions
//   createDynamicRateLimiter,
//   createTypedRateLimiter,

//   // Utility functions
//   resetRateLimit,
//   getRateLimitInfo,
//   getRateLimitMetrics,
//   resetCircuitBreaker,
//   clearMemoryStore,
//   getRateLimitHealth,

//   // Middleware
//   rateLimitInfoMiddleware,
//   shouldSkipRateLimit,

//   // Configuration
//   RATE_LIMIT_CONFIG,
//   getRateLimitConfig,

//   // For monitoring
//   redisCircuitBreaker,

//   // Export ipKeyGenerator
//   ipKeyGenerator,

//   // Export the store creation function for testing
//   createEnhancedRedisStore,

//   // Export the store instance
//   rateLimitStore,
// };