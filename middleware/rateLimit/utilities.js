// const redis = require("@config/redis");
// const logger = require("@utils/logger");
// const { RedisCircuitBreaker } = require("./circuitBreaker");
// const { RateLimitInfo } = require("./types");

// const createStoreFactory = (circuitBreaker, createEnhancedRedisStore) => {
//   const createStore = () => {
//     try {
//       const client = redis.getClient();
//       if (client && client.isReady) {
//         logger.info("Using Redis store for rate limiting");
//         return createEnhancedRedisStore(circuitBreaker);
//       } else {
//         logger.warn("Redis not available, using memory store for rate limiting");
//         return undefined;
//       }
//     } catch (error) {
//       logger.error("Failed to create rate limit store:", error);
//       return undefined;
//     }
//   };

//   return { createStore };
// };

// const createRateLimitUtilities = (circuitBreaker, store) => {
//   const resetRateLimit = async (key, prefix = "rl:") => {
//     try {
//       const client = redis.getClient();
//       if (client && client.isReady) {
//         const fullKey = `${prefix}${key}`;
//         const deleted = await client.del(fullKey);
//         logger.info(`Reset rate limit for key: ${key} (deleted: ${deleted})`);
//         return deleted > 0;
//       }
//     } catch (error) {
//       logger.error("Failed to reset rate limit:", error);
//     }
//     return false;
//   };

//   const getRateLimitInfo = async (key, prefix = "rl:") => {
//     try {
//       const client = redis.getClient();
//       if (client && client.isReady) {
//         const fullKey = `${prefix}${key}`;
//         const data = await client.get(fullKey);

//         if (data) {
//           const parsed = JSON.parse(data);
//           const now = Date.now();
//           const resetTime = new Date(parsed.resetTime);
//           const remaining = Math.max(0, parsed.limit - parsed.totalHits);
//           const timeUntilReset = Math.max(0, resetTime.getTime() - now);

//           return {
//             totalHits: parsed.totalHits,
//             limit: parsed.limit,
//             remaining,
//             resetTime,
//             timeUntilReset,
//             isExceeded: parsed.totalHits >= parsed.limit,
//           };
//         }
//       }
//     } catch (error) {
//       logger.error("Failed to get rate limit info:", error);
//     }
//     return null;
//   };

//   const getRateLimitMetrics = () => {
//     if (store && store.getMetrics) {
//       return store.getMetrics();
//     }
//     return {
//       error: "Metrics not available",
//       storeType: store ? "redis" : "memory",
//     };
//   };

//   const resetCircuitBreaker = () => {
//     circuitBreaker.reset();
//     return { success: true, message: "Circuit breaker reset" };
//   };

//   const clearMemoryStore = () => {
//     if (store && store.clearMemoryStore) {
//       store.clearMemoryStore();
//       return { success: true, message: "Memory store cleared" };
//     }
//     return { success: false, message: "Memory store not available" };
//   };

//   const getRateLimitHealth = async () => {
//     try {
//       const client = redis.getClient();
//       let redisStatus = "disconnected";

//       if (client) {
//         try {
//           await client.ping();
//           redisStatus = client.isReady ? "ready" : "not ready";
//         } catch (error) {
//           redisStatus = "error";
//         }
//       }

//       // Dynamic import for CommonJS
//       const configModule = require("./config");
      
//       return {
//         status: "ok",
//         rateLimiting: {
//           store: store ? "redis" : "memory",
//           redis: redisStatus,
//           circuitBreaker: circuitBreaker.getStats(),
//         },
//         config: {
//           environment: process.env.NODE_ENV || "development",
//           api: configModule.getRateLimitConfig().api,
//           auth: configModule.getRateLimitConfig().auth,
//         },
//       };
//     } catch (error) {
//       return {
//         status: "error",
//         error: error.message,
//       };
//     }
//   };

//   return {
//     resetRateLimit,
//     getRateLimitInfo,
//     getRateLimitMetrics,
//     resetCircuitBreaker,
//     clearMemoryStore,
//     getRateLimitHealth,
//   };
// };

// module.exports = {
//   createStoreFactory,
//   createRateLimitUtilities,
// };