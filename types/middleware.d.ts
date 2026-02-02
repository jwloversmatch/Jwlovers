// AuthCoreMiddleware
declare module "@middleware/auth/AuthCoreMiddleware" {
  import { Request, Response, NextFunction } from "express";

  const authCoreMiddleware: {
    protect(req: Request, res: Response, next: NextFunction): void;
    optionalAuth(req: Request, res: Response, next: NextFunction): void;
    setSecurityHeaders(req: Request, res: Response, next: NextFunction): void;
  };

  export default authCoreMiddleware;
}

// AuthorizationMiddleware
declare module "@middleware/auth/AuthorizationMiddleware" {
  import { Request, Response, NextFunction } from "express";

  const authorizationMiddleware: {
    authorize(...roles: string[]): (req: Request, res: Response, next: NextFunction) => void;
    authorizeUserType(...userTypes: string[]): (req: Request, res: Response, next: NextFunction) => void;
    requireMinimumRole(role: string): (req: Request, res: Response, next: NextFunction) => void;
    userOnly(req: Request, res: Response, next: NextFunction): void;
    staffOnly(req: Request, res: Response, next: NextFunction): void;
    moderatorOnly(req: Request, res: Response, next: NextFunction): void;
    adminOnly(req: Request, res: Response, next: NextFunction): void;
    superAdminOnly(req: Request, res: Response, next: NextFunction): void;
  };

  export default authorizationMiddleware;
}

// SpecializedAuthMiddleware
declare module "@middleware/auth/SpecializedAuthMiddleware" {
  import { Request, Response, NextFunction } from "express";

  const specializedAuthMiddleware: {
    verifiedOnly(req: Request, res: Response, next: NextFunction): void;
    profileCompleted(req: Request, res: Response, next: NextFunction): void;
    requireOwnership(req: Request, res: Response, next: NextFunction): void;
  };

  export default specializedAuthMiddleware;
}
