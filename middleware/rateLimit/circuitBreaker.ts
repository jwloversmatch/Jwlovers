// import logger from "@utils/logger";
// import { RedisCircuitBreakerStats } from "./types";

// export class RedisCircuitBreaker {
//   private failureThreshold: number;
//   private resetTimeout: number;
//   private failureCount: number;
//   private lastFailureTime: number | null;
//   private state: "CLOSED" | "OPEN" | "HALF_OPEN";
//   private metrics: {
//     totalRequests: number;
//     failedRequests: number;
//     stateTransitions: number;
//   };

//   constructor(failureThreshold = 3, resetTimeout = 60000) {
//     this.failureThreshold = failureThreshold;
//     this.resetTimeout = resetTimeout;
//     this.failureCount = 0;
//     this.lastFailureTime = null;
//     this.state = "CLOSED";
//     this.metrics = {
//       totalRequests: 0,
//       failedRequests: 0,
//       stateTransitions: 0,
//     };
//   }

//   async execute<T>(operation: () => Promise<T>): Promise<T> {
//     this.metrics.totalRequests++;

//     if (this.state === "OPEN") {
//       if (this.lastFailureTime && (Date.now() - this.lastFailureTime > this.resetTimeout)) {
//         this.state = "HALF_OPEN";
//         this.metrics.stateTransitions++;
//         logger.info("Rate limit circuit breaker transitioning to HALF_OPEN");
//       } else {
//         this.metrics.failedRequests++;
//         throw new Error("Circuit breaker is OPEN");
//       }
//     }

//     try {
//       const result = await operation();

//       if (this.state === "HALF_OPEN") {
//         this.state = "CLOSED";
//         this.failureCount = 0;
//         this.metrics.stateTransitions++;
//         logger.info("Rate limit circuit breaker reset to CLOSED");
//       }

//       return result;
//     } catch (error: any) {
//       this.failureCount++;
//       this.lastFailureTime = Date.now();
//       this.metrics.failedRequests++;

//       if (this.failureCount >= this.failureThreshold) {
//         this.state = "OPEN";
//         this.metrics.stateTransitions++;
//         logger.error(
//           `Rate limit circuit breaker OPEN after ${this.failureCount} failures`,
//           {
//             error: error.message,
//             lastFailureTime: new Date(this.lastFailureTime).toISOString(),
//           }
//         );
//       }

//       throw error;
//     }
//   }

//   getStats(): RedisCircuitBreakerStats {
//     return {
//       ...this.metrics,
//       state: this.state,
//       failureCount: this.failureCount,
//       isOpen: this.state === "OPEN",
//       uptime: this.lastFailureTime ? Date.now() - this.lastFailureTime : null,
//     };
//   }

//   reset(): void {
//     this.state = "CLOSED";
//     this.failureCount = 0;
//     this.lastFailureTime = null;
//     this.metrics.stateTransitions++;
//     logger.info("Rate limit circuit breaker manually reset");
//   }
// }