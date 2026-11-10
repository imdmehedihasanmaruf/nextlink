'use strict';

const { z } = require('zod');

/**
 * Zod request validation middleware.
 *
 * @param {{body?: z.ZodTypeAny, query?: z.ZodTypeAny, params?: z.ZodTypeAny}} schemas
 */
function validate(schemas = {}) {
  return (req, res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.validatedQuery = schemas.query.parse(req.query);
      if (schemas.body) req.validatedBody = schemas.body.parse(req.body);
      return next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.') || '(root)',
            message: issue.message,
          })),
        });
      }
      return next(error);
    }
  };
}

/**
 * Common reusable schemas.
 */
const schemas = {
  id: z.string().min(1, 'id is required'),
  invoiceId: z.string().min(1, 'invoiceId is required'),
  amount: z.coerce.number().positive('amount must be greater than zero'),
  gateway: z.enum(['bkash', 'nagad', 'sslcommerz', 'rocket']),
};

module.exports = { validate, schemas };
