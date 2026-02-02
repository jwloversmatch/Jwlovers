// import { Request, Response } from "express";
// import logger from "@utils/logger";

// interface RateLimitOptions {
//   windowMs: number;
//   max: number;
//   message?: string;
//   key?: string;
// }

// export const rateLimitHandler = (req: Request, res: Response, options: RateLimitOptions) => {
//   const retryAfter = Math.ceil(options.windowMs / 1000);
//   const isAuthEndpoint =
//     req.path.includes("/auth") || req.path.includes("/login");

//   let message = options.message || "Too many requests, please try again later.";

//   if (isAuthEndpoint) {
//     message =
//       "Too many authentication attempts. Please try again later or reset your password.";
//   }

//   logger.warn("Rate limit exceeded", {
//     path: req.path,
//     ip: req.ip,
//     userAgent: req.headers["user-agent"]?.substring(0, 100),
//     userId: req.user?.id,
//     key: options.key,
//     retryAfter,
//   });

//   res.setHeader("Retry-After", retryAfter);
//   res.setHeader("X-RateLimit-Limit", options.max);
//   res.setHeader("X-RateLimit-Remaining", 0);
//   res.setHeader(
//     "X-RateLimit-Reset",
//     Math.floor(Date.now() / 1000) + retryAfter
//   );

//   res.status(429).json({
//     success: false,
//     error: message,
//     code: "RATE_LIMIT_EXCEEDED",
//     retryAfter,
//     path: req.path,
//     timestamp: new Date().toISOString(),
//     documentation:
//       process.env.API_DOCS_URL ||
//       "https://your-dating-app.com/docs/rate-limiting",
//   });
// };

// export const shouldSkipRateLimit = (req: Request): boolean => {
//   const skipRoutes = ["/health", "/metrics", "/status", "/docs", "/api-docs"];

//   if (skipRoutes.some((route) => req.path.startsWith(route))) {
//     return true;
//   }

//   const whitelistedIPs = (process.env.RATE_LIMIT_WHITELIST_IPS || "")
//     .split(",")
//     .filter((ip) => ip.trim());
//   if (whitelistedIPs.includes(req.ip!)) {
//     logger.debug(`Rate limit skipped for whitelisted IP: ${req.ip}`);
//     return true;
//   }

//   const isPrivateIP = (ip: string): boolean => {
//     if (ip === "::1" || ip === "127.0.0.1") return true;

//     if (ip.includes(":")) {
//       return ip === "::ffff:127.0.0.1" || ip === "0:0:0:0:0:0:0:1";
//     }

//     const parts = ip.split(".").map(Number);
//     return (
//       parts[0] === 10 ||
//       (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
//       (parts[0] === 192 && parts[1] === 168) ||
//       (parts[0] === 169 && parts[1] === 254) 
//     );
//   };

//   if (
//     req.ip &&
//     isPrivateIP(req.ip) &&
//     process.env.SKIP_RATE_LIMIT_FOR_PRIVATE_IPS === "true"
//   ) {
//     return true;
//   }

//   const apiKey = req.headers["x-api-key"] as string;
//   const unlimitedKeys = (process.env.UNLIMITED_API_KEYS || "")
//     .split(",")
//     .filter((key) => key.trim());

//   if (apiKey && unlimitedKeys.includes(apiKey)) {
//     logger.debug(`Rate limit skipped for unlimited API key: ${apiKey.substring(0, 8)}...`);
//     return true;
//   }

//   const emergencyToken = req.headers["x-emergency-token"] as string;
//   if (emergencyToken && emergencyToken === process.env.EMERGENCY_BYPASS_TOKEN) {
//     logger.warn(`Emergency rate limit bypass used for IP: ${req.ip}`);
//     return true;
//   }

//   return false;
// };