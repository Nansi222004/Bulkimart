// Centralized Error Handling Middleware
export const errorHandler = (err, req, res, next) => {
  // Precedence: an explicit err.status (from utils/response.js httpError) wins,
  // then a status already set on the response, then 500.
  // Note: res.statusCode defaults to 200, and a controller may have set 201 before
  // throwing — treat any 2xx as "no error status was set".
  let statusCode = err.status || err.statusCode;
  let publicMessage = err.message || 'Internal Server Error';
  if (!statusCode) {
    statusCode = res.statusCode >= 400 ? res.statusCode : 500;
  }

  // Mongoose-specific errors mapped to sensible HTTP codes
  if (err.name === 'ValidationError') statusCode = 400;
  if (err.name === 'CastError') statusCode = 400;
  if (err.code === 11000) {
    statusCode = 409;
    const duplicateFields = Object.keys(err.keyPattern || {});
    if (duplicateFields.includes('email') && err.keyValue?.email == null) {
      publicMessage = 'Seller registration is temporarily unavailable. Please try again later or contact support.';
    } else if (duplicateFields.includes('email')) {
      publicMessage = 'This email address is already associated with a seller account.';
    } else if (duplicateFields.includes('userId')) {
      publicMessage = 'A seller profile already exists for this account. Please sign in to your seller account.';
    } else {
      publicMessage = 'A record with these details already exists. Please review the information and try again.';
    }
  }
  if (err.name === 'MulterError') statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(err.code)) {
    statusCode = 503;
    err.message = 'Private e-book storage is unavailable. Check local storage configuration and permissions.';
  }

  res.status(statusCode).json({
    success: false,
    data: null,
    message: publicMessage,
    meta: err.meta || {},
    // Only expose stacks when explicitly in development. Any other NODE_ENV value
    // (unset, "prod", "staging") is treated as non-development and leaks nothing.
    ...(process.env.NODE_ENV === 'development' && err.code !== 11000 ? { stack: err.stack } : {}),
  });
};

// Async Handler wrapper to avoid try-catch blocks in controllers
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
