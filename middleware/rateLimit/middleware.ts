// import { Request, Response, NextFunction } from "express";
// import { rateLimit, ipKeyGenerator } from "express-rate-limit";
// import logger from "@utils/logger";
// import { shouldSkipRateLimit, rateLimitHandler } from "./handlers";
// import { DynamicRateLimiterOptions } from "./types";

// export const rateLimitInfoMiddleware = (req: Request, res: Response, next: NextFunction) => {
//   const originalSend = res.send;

//   res.send = function (body: any) {
//     if (req.rateLimit && typeof req.rateLimit === 'object') {
//       try {
//         const limit = req.rateLimit.limit || req.rateLimit.max;
//         const remaining = req.rateLimit.remaining || 
//                          (limit !== undefined ? limit - (req.rateLimit.used || 0) : undefined);
        
//         if (limit !== undefined && limit !== null) {
//           res.setHeader("X-RateLimit-Limit", limit);
//         }
        
//         if (remaining !== undefined && remaining !== null) {
//           res.setHeader("X-RateLimit-Remaining", remaining);
//         }
        
//         if (req.rateLimit.resetTime) {
//           const reset = Math.ceil(req.rateLimit.resetTime.getTime() / 1000);
//           res.setHeader("X-RateLimit-Reset", reset);
//         }
//       } catch (error: any) {
//         logger.debug('Error setting rate limit headers:', error.message);
//       }
//     }

//     return originalSend.call(this, body);
//   };

//   next();
// };

// export const createDynamicRateLimiter = (options: DynamicRateLimiterOptions = {}, store?: any) => {
//   const {
//     windowMs = 15 * 60 * 1000,
//     max = 100,
//     keyGenerator = ipKeyGenerator,
//     message = "Rate limit exceeded",
//     skip = shouldSkipRateLimit,
//     skipSuccessfulRequests = false,
//     blockDuration,
//   } = options;

//   return rateLimit({
//     windowMs,
//     max,
//     message,
//     standardHeaders: true,
//     legacyHeaders: false,
//     skip,
//     skipSuccessfulRequests,
//     handler: rateLimitHandler,
//     keyGenerator,
//     store,
//     validate: false,
//     ...(blockDuration && { blockDuration }),
//   });
// };

// export const createTypedRateLimiter = (type: string, customOptions: DynamicRateLimiterOptions = {}, store?: any) => {
//   const typeConfigs: Record<string, any> = {
//     presence: {
//       windowMs: 10000,
//       max: 30,
//       message: "Too many presence requests.",
//       keyGenerator: (req: Request) => `presence:${ipKeyGenerator(req)}`,
//     },
//     profile: {
//       windowMs: 60000,
//       max: 20,
//       message: "Too many profile requests.",
//       keyGenerator: (req: Request) => `profile:${ipKeyGenerator(req)}`,
//     },
//     admin: {
//       windowMs: 30000,
//       max: 10,
//       message: "Too many admin requests.",
//       keyGenerator: (req: Request) => `admin:${ipKeyGenerator(req)}`,
//     },
//     default: {
//       windowMs: 15 * 60 * 1000,
//       max: 100,
//       message: "Too many requests.",
//       keyGenerator: ipKeyGenerator,
//     },
//   };

//   const config = typeConfigs[type] || typeConfigs.default;

//   return rateLimit({
//     windowMs: customOptions.windowMs || config.windowMs,
//     max: customOptions.max || config.max,
//     message: customOptions.message || config.message,
//     keyGenerator: customOptions.keyGenerator || config.keyGenerator,
//     standardHeaders: true,
//     legacyHeaders: false,
//     skip: shouldSkipRateLimit,
//     handler: rateLimitHandler,
//     store,
//     validate: false,
//     ...customOptions,
//   });
// };