// import logger from "@utils/logger";

// export interface RateLimitConfig {
//   api: {
//     windowMs: number;
//     max: number;
//   };
//   auth: {
//     windowMs: number;
//     max: number;
//     blockDuration?: number;
//   };
//   messages: {
//     windowMs: number;
//     max: number;
//     blockDuration?: number;
//   };
//   registration: {
//     windowMs: number;
//     max: number;
//     blockDuration?: number;
//   };
//   socket: {
//     windowMs: number;
//     max: number;
//   };
// }

// export const getRateLimitConfig = (): RateLimitConfig => {
//   const env = process.env.NODE_ENV || "development";

//   const baseConfigs: Record<string, RateLimitConfig> = {
//     production: {
//       api: {
//         windowMs: 15 * 60 * 1000,
//         max: parseInt(process.env.RATE_LIMIT_API_MAX || "100"),
//       },
//       auth: {
//         windowMs: 60 * 60 * 1000,
//         max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || "10"),
//         blockDuration: 30 * 60 * 1000,
//       },
//       messages: {
//         windowMs: 60 * 1000,
//         max: parseInt(process.env.RATE_LIMIT_MESSAGES_MAX || "60"),
//         blockDuration: 5 * 60 * 1000,
//       },
//       registration: {
//         windowMs: 24 * 60 * 60 * 1000,
//         max: parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX || "5"),
//         blockDuration: 24 * 60 * 60 * 1000,
//       },
//       socket: {
//         windowMs: 60 * 1000,
//         max: parseInt(process.env.RATE_LIMIT_SOCKET_MAX || "120"),
//       },
//     },
//     development: {
//       api: {
//         windowMs: 15 * 60 * 1000,
//         max: 1000,
//       },
//       auth: {
//         windowMs: 60 * 60 * 1000,
//         max: 100,
//       },
//       messages: {
//         windowMs: 60 * 1000,
//         max: 600,
//       },
//       registration: {
//         windowMs: 24 * 60 * 60 * 1000,
//         max: 50,
//       },
//       socket: {
//         windowMs: 60 * 1000,
//         max: 1200,
//       },
//     },
//     test: {
//       api: {
//         windowMs: 15 * 60 * 1000,
//         max: 5000,
//       },
//       auth: {
//         windowMs: 60 * 60 * 1000,
//         max: 500,
//       },
//       messages: {
//         windowMs: 60 * 1000,
//         max: 3000,
//       },
//       registration: {
//         windowMs: 24 * 60 * 60 * 1000,
//         max: 100,
//       },
//       socket: {
//         windowMs: 60 * 1000,
//         max: 5000,
//       },
//     },
//   };

//   const config = baseConfigs[env] || baseConfigs.development;

//   // Override with environment variables
//   if (process.env.RATE_LIMIT_API_MAX) {
//     config.api.max = parseInt(process.env.RATE_LIMIT_API_MAX);
//   }
//   if (process.env.RATE_LIMIT_AUTH_MAX) {
//     config.auth.max = parseInt(process.env.RATE_LIMIT_AUTH_MAX);
//   }
//   if (process.env.RATE_LIMIT_MESSAGES_MAX) {
//     config.messages.max = parseInt(process.env.RATE_LIMIT_MESSAGES_MAX);
//   }
//   if (process.env.RATE_LIMIT_REGISTRATION_MAX) {
//     config.registration.max = parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX);
//   }
//   if (process.env.RATE_LIMIT_SOCKET_MAX) {
//     config.socket.max = parseInt(process.env.RATE_LIMIT_SOCKET_MAX);
//   }

//   logger.info(`📊 Rate limit config loaded for ${env} environment`);
//   logger.info(`   API: ${config.api.max} requests/${config.api.windowMs / 60000} minutes`);
//   logger.info(`   Auth: ${config.auth.max} requests/${config.auth.windowMs / 3600000} hours`);
//   logger.info(`   Messages: ${config.messages.max} messages/minute`);
//   logger.info(`   Registration: ${config.registration.max} registrations/24 hours`);

//   return config;
// };

// export const RATE_LIMIT_CONFIG = {
//   production: getRateLimitConfig(),
//   development: getRateLimitConfig(),
//   test: getRateLimitConfig(),
// };