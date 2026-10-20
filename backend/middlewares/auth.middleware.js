import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { asyncHandler } from './error.middleware.js';
import { verifySessionToken } from '../config/jwt.js';
import { authFailure } from '../utils/authFailure.js';

export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) throw authFailure(req, 'AUTH_HEADER_MISSING', 'Not authorized — no token provided');
  const bearer = typeof header === 'string' && /^Bearer[\t ]+([^\s,]+)[\t ]*$/i.exec(header);
  if (!bearer) throw authFailure(req, 'AUTH_BEARER_MALFORMED', 'Not authorized — provide one Bearer token');
  const token = bearer[1];

  // Only the verify call belongs in the try/catch. Wrapping the checks below would
  // rewrite their specific 401/403 messages into a misleading "invalid token".
  let decoded;
  try {
    decoded = verifySessionToken(token);
  } catch (error) {
    const code = error.name === 'TokenExpiredError' ? 'AUTH_TOKEN_EXPIRED'
      : error.name === 'NotBeforeError' ? 'AUTH_TOKEN_NOT_ACTIVE'
        : error.message === 'invalid signature' ? 'AUTH_SIGNATURE_INVALID'
          : error.message === 'invalid algorithm' ? 'AUTH_ALGORITHM_INVALID' : 'AUTH_TOKEN_INVALID';
    throw authFailure(req, code, code === 'AUTH_TOKEN_EXPIRED' ? 'Not authorized — token expired. Please sign in again.' : 'Not authorized — invalid token');
  }

  if (!decoded || typeof decoded !== 'object' || typeof decoded.id !== 'string' || !/^[a-f\d]{24}$/i.test(decoded.id)) {
    throw authFailure(req, 'AUTH_CLAIMS_INVALID', 'Not authorized — invalid session identity');
  }

  // Older signed user tokens omitted type/role. Retain their existing user-only
  // interpretation; /auth/me resolves their role from live membership records.
  if ((decoded.type !== undefined && !['admin', 'user'].includes(decoded.type)) || (decoded.role !== undefined && !['buyer', 'seller', 'delivery'].includes(decoded.role))) {
    throw authFailure(req, 'AUTH_CLAIMS_UNSUPPORTED', 'Not authorized — unsupported session');
  }

  if (decoded.type === 'admin') {
    req.user = await Admin.findById(decoded.id).select('-password');
    req.userType = 'admin';
  } else {
    req.user = await User.findById(decoded.id).select('-wallet.transactions');
    req.userType = 'user';
    // Signed entry-point context; live membership/approval is checked separately.
    req.tokenRole = decoded.role;
  }

  if (!req.user) {
    throw authFailure(req, 'AUTH_ACCOUNT_NOT_FOUND', 'Not authorized — account not found');
  }

  if (!req.user.isActive) {
    throw authFailure(req, 'AUTH_ACCOUNT_INACTIVE', 'Access denied — account is deactivated', 403);
  }

  next();
});

export const requireAdmin = (req, res, next) => {
  if (req.userType !== 'admin') {
    throw authFailure(req, 'AUTH_ROLE_REQUIRED', 'Forbidden — Admin access required', 403);
  }
  next();
};

export const requireRole = (...roles) => (req, res, next) => {
  if (req.userType === 'admin') {
    return next(); // Admins bypass role checks
  }

  const hasRole = roles.some(role => req.user.roles && req.user.roles.includes(role));
  if (!hasRole) {
    throw authFailure(req, 'AUTH_ROLE_REQUIRED', `Forbidden — requires one of these roles: ${roles.join(', ')}`, 403);
  }
  next();
};

// Entry-point claims are signed by the server, not supplied in request data.
export const requireSellerSession = (req, res, next) => {
  if (req.tokenRole !== undefined && req.tokenRole !== 'seller') {
    throw authFailure(req, 'AUTH_ROLE_REQUIRED', 'Sign in through the seller portal to continue', 403);
  }
  next();
};
export const requireCustomerSession = (req, res, next) => {
  if (req.userType !== 'user' || req.tokenRole === 'seller' || !req.user.roles?.includes('buyer')) {
    throw authFailure(req, 'AUTH_ROLE_REQUIRED', 'A customer session is required', 403);
  }
  next();
};
