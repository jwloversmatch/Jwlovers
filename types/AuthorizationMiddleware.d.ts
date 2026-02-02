import { Request, Response, NextFunction } from "express";

interface AuthRequest extends Request {
  user?: {
    _id?: string;
    role?: string;
    userType?: string;
    [key: string]: any;
  };
}

interface AuthorizeOptions {
  allowHigherRoles?: boolean;
}

// Allow each argument to be either a string role or the options object
type RoleOrOptions = string | AuthorizeOptions;

declare class AuthorizationMiddleware {
  authorize(...allowedRoles: RoleOrOptions[]): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  authorizeUserType(...allowedUserTypes: string[]): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  requireMinimumRole(minimumRole: string): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;

  // Convenience getters
  readonly userOnly: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  readonly staffOnly: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  readonly moderatorOnly: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  readonly adminOnly: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  readonly superAdminOnly: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
}

declare const _default: AuthorizationMiddleware;
export = _default;
