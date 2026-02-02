// import { rateLimit, ipKeyGenerator } from "express-rate-limit";
// import { getRateLimitConfig } from "./config";
// import { rateLimitHandler, shouldSkipRateLimit } from "./handlers";
// import {
//   getKeyGenerator,
//   getUploadKeyGenerator,
//   getSearchKeyGenerator,
//   getProfileViewKeyGenerator,
//   getPasswordResetKeyGenerator,
//   getEmailResendKeyGenerator,
//   getProfileUpdateKeyGenerator,
// } from "./keyGenerators";
// import { createDynamicRateLimiter } from "./middleware";
// import { RateLimitStore } from "./types";

// const config = getRateLimitConfig();

// const createLimiters = (store?: RateLimitStore) => {
//   const apiLimiter = rateLimit({
//     windowMs: config.api.windowMs,
//     max: config.api.max,
//     message: "Too many API requests from this IP.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     skip: shouldSkipRateLimit,
//     handler: rateLimitHandler,
//     keyGenerator: getKeyGenerator("api"),
//     store,
//     validate: false,
//   });

//   const authLimiter = rateLimit({
//     windowMs: config.auth.windowMs,
//     max: config.auth.max,
//     message: "Too many authentication attempts.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     skip: shouldSkipRateLimit,
//     skipSuccessfulRequests: true,
//     handler: rateLimitHandler,
//     keyGenerator: getKeyGenerator("auth"),
//     store,
//     validate: false,
//   });

//   const messageLimiter = rateLimit({
//     windowMs: config.messages.windowMs,
//     max: config.messages.max,
//     message: "Message sending rate limit exceeded.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     handler: rateLimitHandler,
//     keyGenerator: getKeyGenerator("messages"),
//     store,
//     validate: false,
//   });

//   const registrationLimiter = rateLimit({
//     windowMs: config.registration.windowMs,
//     max: config.registration.max,
//     message: "Too many registration attempts from this IP/email.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     skip: shouldSkipRateLimit,
//     handler: rateLimitHandler,
//     keyGenerator: getKeyGenerator("registration"),
//     store,
//     validate: false,
//   });

//   const uploadLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000,
//     max: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX || "50"),
//     message: "Too many uploads, please try again later.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     handler: rateLimitHandler,
//     keyGenerator: getUploadKeyGenerator(),
//     store,
//     validate: false,
//   });

//   const searchLimiter = rateLimit({
//     windowMs: 60 * 1000,
//     max: parseInt(process.env.RATE_LIMIT_SEARCH_MAX || "30"),
//     message: "Too many search requests, please try again later.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     handler: rateLimitHandler,
//     keyGenerator: getSearchKeyGenerator(),
//     store,
//     validate: false,
//   });

//   const profileViewLimiter = rateLimit({
//     windowMs: 60 * 1000,
//     max: parseInt(process.env.RATE_LIMIT_PROFILE_VIEWS_MAX || "60"),
//     message: "Too many profile views, please slow down.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     handler: rateLimitHandler,
//     keyGenerator: getProfileViewKeyGenerator(),
//     store,
//     validate: false,
//   });

//   const passwordResetLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000,
//     max: 5,
//     message: "Too many password reset requests. Please wait before trying again.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     handler: rateLimitHandler,
//     keyGenerator: getPasswordResetKeyGenerator(),
//     store,
//     validate: false,
//   });

//   const emailResendLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000,
//     max: 3,
//     message: "Too many verification email requests. Please wait before trying again.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     handler: rateLimitHandler,
//     keyGenerator: getEmailResendKeyGenerator(),
//     store,
//     validate: false,
//   });

//   const profileUpdateLimiter = rateLimit({
//     windowMs: 15 * 60 * 1000,
//     max: 20,
//     message: "Too many profile updates. Please wait before making more changes.",
//     standardHeaders: true,
//     legacyHeaders: false,
//     handler: rateLimitHandler,
//     keyGenerator: getProfileUpdateKeyGenerator(),
//     store,
//     validate: false,
//   });

//   return {
//     apiLimiter,
//     authLimiter,
//     messageLimiter,
//     registrationLimiter,
//     uploadLimiter,
//     searchLimiter,
//     profileViewLimiter,
//     passwordResetLimiter,
//     emailResendLimiter,
//     profileUpdateLimiter,
//   };
// };

// export { createLimiters, createDynamicRateLimiter };