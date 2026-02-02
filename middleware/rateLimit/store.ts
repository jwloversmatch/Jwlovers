// import RedisStore from "rate-limit-redis";
// import redis from "@config/redis";
// import logger from "@utils/logger";
// import { RateLimitStore, RateLimitMetrics } from "./types";
// import { RedisCircuitBreaker } from "./circuitBreaker";

// const createEnhancedRedisStore = (circuitBreaker: RedisCircuitBreaker): RateLimitStore => {
//   const memoryStore = new Map<string, {
//     hits: number[];
//     resetTime: number;
//     lastCleanup: number;
//   }>();
  
//   const metrics = {
//     redisHits: 0,
//     memoryFallbacks: 0,
//     errors: 0,
//     lastFallbackTime: null as number | null,
//   };

//   const executeRedisCommand = async (command: string, ...params: any[]): Promise<any> => {
//     try {
//       const client = redis.getClient();

//       if (!client || !(client as any).isReady) {
//         throw new Error("Redis client not available or not ready");
//       }

//       const startTime = Date.now();
//       let result;

//       switch (command.toLowerCase()) {
//         case "set":
//           if (params.length >= 3) {
//             result = await (client as any).set(params[0], params[1], { EX: params[2] });
//           } else {
//             result = await (client as any).set(params[0], params[1]);
//           }
//           break;
//         case "get":
//           result = await (client as any).get(params[0]);
//           break;
//         case "incr":
//           result = await (client as any).incr(params[0]);
//           break;
//         case "incrby":
//           result = await (client as any).incrBy(params[0], parseInt(params[1]));
//           break;
//         case "del":
//           result = await (client as any).del(params);
//           break;
//         case "expire":
//           result = await (client as any).expire(params[0], parseInt(params[1]));
//           break;
//         case "exists":
//           result = await (client as any).exists(params);
//           break;
//         case "eval":
//           result = await (client as any).eval(params[0], {
//             keys: params[1] || [],
//             arguments: params[2] || [],
//           });
//           break;
//         default:
//           try {
//             result = await (client as any).sendCommand([command, ...params]);
//           } catch {
//             logger.warn(`Redis command ${command} not supported via sendCommand`);
//             return null;
//           }
//       }

//       const duration = Date.now() - startTime;
//       if (duration > 100) {
//         logger.warn(`Slow Redis command: ${command} took ${duration}ms`);
//       }

//       metrics.redisHits++;
//       return result;
//     } catch (error: any) {
//       metrics.errors++;
//       metrics.memoryFallbacks++;
//       metrics.lastFallbackTime = Date.now();

//       logger.warn("Redis command failed, using memory fallback:", {
//         command,
//         error: error.message,
//         memoryFallbacks: metrics.memoryFallbacks,
//       });

//       return null;
//     }
//   };

//   const store = new RedisStore({
//     sendCommand: async (...args: string[]) => {
//       try {
//         const result = await circuitBreaker.execute(async () => {
//           return await executeRedisCommand(...args);
//         });
//         return result;
//       } catch (error: any) {
//         metrics.errors++;
//         metrics.memoryFallbacks++;
//         metrics.lastFallbackTime = Date.now();
//         logger.warn("Circuit breaker triggered for Redis command:", {
//           command: args[0],
//           error: error.message,
//         });
//         return null;
//       }
//     },
//     prefix: "rl:",
//   }) as any;

//   const originalIncrement = store.increment.bind(store);

//   store.increment = async (key: string, windowMs: number, opts: any = {}): Promise<{
//     totalHits: number;
//     resetTime: Date;
//   }> => {
//     try {
//       const result = await originalIncrement(key, windowMs, opts);
//       return result;
//     } catch (error: any) {
//       metrics.memoryFallbacks++;
//       metrics.lastFallbackTime = Date.now();

//       logger.warn("Rate limit increment failed, using memory fallback:", {
//         key,
//         error: error.message,
//         totalMemoryFallbacks: metrics.memoryFallbacks,
//       });

//       const memoryKey = `memory:${key}`;
//       const now = Date.now();

//       if (!memoryStore.has(memoryKey)) {
//         memoryStore.set(memoryKey, {
//           hits: [],
//           resetTime: now + windowMs,
//           lastCleanup: now,
//         });
//       }

//       const data = memoryStore.get(memoryKey)!;
//       const cutoff = now - windowMs;
//       data.hits = data.hits.filter((timestamp) => timestamp > cutoff);
//       data.hits.push(now);
//       data.resetTime = now + windowMs;

//       if (now - data.lastCleanup > 60000) {
//         for (const [k, d] of memoryStore.entries()) {
//           if (now > d.resetTime + 60000) {
//             memoryStore.delete(k);
//           }
//         }
//         data.lastCleanup = now;
//       }

//       const totalHits = data.hits.length;

//       return {
//         totalHits,
//         resetTime: new Date(data.resetTime),
//       };
//     }
//   };

//   store.getMetrics = (): RateLimitMetrics => ({
//     ...metrics,
//     memoryStoreSize: memoryStore.size,
//     circuitBreaker: circuitBreaker.getStats(),
//     redisStatus: (redis.getClient() as any)?.isReady ? "ready" : "not ready",
//   });

//   store.clearMemoryStore = (): void => {
//     const size = memoryStore.size;
//     memoryStore.clear();
//     logger.info(`Cleared memory rate limit store (${size} entries)`);
//   };

//   store.resetRedisConnection = async (): Promise<void> => {
//     try {
//       const client = redis.getClient();
//       if (client) {
//         await (client as any).quit();
//         logger.info("Redis connection reset requested");
//       }
//     } catch (error: any) {
//       logger.error("Failed to reset Redis connection:", error);
//     }
//   };

//   return store as RateLimitStore;
// };

// export { createEnhancedRedisStore };