// import { Request } from "express";
// import validator from "validator";
// import { ipKeyGenerator } from "express-rate-limit";

// export const getKeyGenerator = (type: string) => {
//   switch (type) {
//     case "auth":
//       return (req: Request) => {
//         const email = req.body?.email;
//         if (email && validator.isEmail(email)) {
//           return `auth:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}`;
//         }
//         return `auth:${ipKeyGenerator(req)}`;
//       };

//     case "registration":
//       return (req: Request) => {
//         const email = req.body?.email;
//         if (email && validator.isEmail(email)) {
//           return `reg:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}`;
//         }
//         return `reg:${ipKeyGenerator(req)}`;
//       };

//     case "messages":
//       return (req: Request) => {
//         const userId = req.user?.id;
//         const conversationId = req.params?.conversationId || req.body?.conversationId;

//         if (userId && conversationId) {
//           return `msg:user:${userId}:conv:${conversationId}`;
//         }

//         return userId ? `msg:user:${userId}` : `msg:ip:${ipKeyGenerator(req)}`;
//       };

//     case "user":
//       return (req: Request) => {
//         return req.user?.id
//           ? `user:${req.user.id}`
//           : `ip:${ipKeyGenerator(req)}`;
//       };

//     default:
//       return (req: Request) => {
//         const apiKey = req.headers["x-api-key"] as string;
//         return apiKey
//           ? `${ipKeyGenerator(req)}:${apiKey}`
//           : ipKeyGenerator(req);
//       };
//   }
// };

// export const getUploadKeyGenerator = () => {
//   return (req: Request) => {
//     return req.user
//       ? `upload:user:${req.user.id}`
//       : `upload:ip:${ipKeyGenerator(req)}`;
//   };
// };

// export const getSearchKeyGenerator = () => {
//   return (req: Request) => {
//     return req.user
//       ? `search:user:${req.user.id}`
//       : `search:ip:${ipKeyGenerator(req)}`;
//   };
// };

// export const getProfileViewKeyGenerator = () => {
//   return (req: Request) => {
//     const profileId = req.params?.userId || req.params?.id;
//     return `profile:view:${ipKeyGenerator(req)}:${profileId || "general"}`;
//   };
// };

// export const getPasswordResetKeyGenerator = () => {
//   return (req: Request) => {
//     const email = req.body?.email;
//     if (email && validator.isEmail(email)) {
//       return `password_reset:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}`;
//     }
//     return `password_reset:${ipKeyGenerator(req)}`;
//   };
// };

// export const getEmailResendKeyGenerator = () => {
//   return (req: Request) => {
//     const email = req.body?.email;
//     if (email && validator.isEmail(email)) {
//       return `email_resend:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}`;
//     }
//     return `email_resend:${ipKeyGenerator(req)}`;
//   };
// };

// export const getProfileUpdateKeyGenerator = () => {
//   return (req: Request) => {
//     return req.user
//       ? `profile_update:user:${req.user.id}`
//       : `profile_update:ip:${ipKeyGenerator(req)}`;
//   };
// };