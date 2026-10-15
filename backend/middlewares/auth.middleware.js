import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { asyncHandler } from './error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';

export const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    res.status(401);
    throw new Error('Not authorized — no token provided');
  }

  // Only the verify call belongs in the try/catch. Wrapping the checks below would
  // rewrite their specific 401/403 messages into a misleading "invalid token".
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401);
    throw new Error('Not authorized — invalid token');
  }

  // Older signed user tokens omitted type/role. Retain their existing user-only
  // interpretation; /auth/me resolves their role from live membership records.
  if ((decoded.type !== undefined && !['admin', 'user'].includes(decoded.type)) || (decoded.role !== undefined && !['buyer', 'seller', 'delivery'].includes(decoded.role))) {
    res.status(401);
    throw new Error('Not authorized — unsupported session');
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
    res.status(401);
    throw new Error('Not authorized — account not found');
  }

  if (!req.user.isActive) {
    res.status(403);
    throw new Error('Access denied — account is deactivated');
  }

  next();
});

export const requireAdmin = (req, res, next) => {
  if (req.userType !== 'admin') {
    res.status(403);
    throw new Error('Forbidden — Admin access required');
  }
  next();
};

export const requireRole = (...roles) => (req, res, next) => {
  if (req.userType === 'admin') {
    return next(); // Admins bypass role checks
  }

  const hasRole = roles.some(role => req.user.roles && req.user.roles.includes(role));
  if (!hasRole) {
    res.status(403);
    throw new Error(`Forbidden — requires one of these roles: ${roles.join(', ')}`);
  }
  next();
};
