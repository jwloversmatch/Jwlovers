// import logger from "@utils/logger";
// import redis from "@config/redis";
// import { RedisCircuitBreaker } from "./circuitBreaker";
// import { getRateLimitConfig } from "./config";
// import { SocketWithRateLimit } from "./types";

// const config = getRateLimitConfig();

// export const createSocketRateLimiter = (circuitBreaker: RedisCircuitBreaker) => {
//   const socketRateLimit = (socket: SocketWithRateLimit, next: (err?: Error) => void) => {
//     const userId = socket.user?.id;
//     const ip = (socket as any).handshake.address;

//     if (!userId) {
//       return next(new Error("Authentication required for rate limiting"));
//     }

//     const key = `socket:user:${userId}`;
//     const ipKey = `socket:ip:${ip}`;
//     const windowMs = config.socket.windowMs;
//     const userMax = config.socket.max;
//     const ipMax = Math.floor(config.socket.max * 0.5);

//     const now = Date.now();

//     circuitBreaker
//       .execute(async () => {
//         const client = redis.getClient();

//         if (!client || !(client as any).isReady) {
//           logger.warn("Redis not available for socket rate limiting");
//           return next();
//         }

//         try {
//           const pipeline = (client as any).multi();
//           pipeline.zadd(key, now, `event:${now}:${Math.random()}`);
//           pipeline.zremrangebyscore(key, 0, now - windowMs);
//           pipeline.zcard(key);
//           pipeline.expire(key, Math.ceil(windowMs / 1000));

//           pipeline.zadd(ipKey, now, `ip:${now}:${Math.random()}`);
//           pipeline.zremrangebyscore(ipKey, 0, now - windowMs);
//           pipeline.zcard(ipKey);
//           pipeline.expire(ipKey, Math.ceil(windowMs / 1000));

//           const results = await pipeline.exec();
//           const userCount = results[2][1];
//           const ipCount = results[5][1];

//           if (userCount > userMax) {
//             logger.warn(`Socket user rate limit exceeded for user ${userId}: ${userCount}/${userMax}`);
//             return next(
//               new Error(`User rate limit exceeded: ${userCount}/${userMax} events per minute`)
//             );
//           }

//           if (ipCount > ipMax) {
//             logger.warn(`Socket IP rate limit exceeded for IP ${ip}: ${ipCount}/${ipMax}`);
//             return next(
//               new Error(`IP rate limit exceeded: ${ipCount}/${ipMax} events per minute`)
//             );
//           }

//           socket.rateLimit = {
//             user: {
//               current: userCount,
//               limit: userMax,
//               remaining: userMax - userCount,
//               reset: Math.ceil((now + windowMs) / 1000),
//             },
//             ip: {
//               current: ipCount,
//               limit: ipMax,
//               remaining: ipMax - ipCount,
//             },
//           };

//           if (userCount > userMax * 0.8) {
//             socket.emit("rate_limit_warning", {
//               type: "user",
//               current: userCount,
//               limit: userMax,
//               remaining: userMax - userCount,
//             });
//           }

//           next();
//         } catch (error: any) {
//           logger.error("Socket rate limit error:", {
//             error: error.message,
//             userId,
//             ip,
//           });
//           next();
//         }
//       })
//       .catch(() => {
//         next();
//       });
//   };

//   return socketRateLimit;
// };