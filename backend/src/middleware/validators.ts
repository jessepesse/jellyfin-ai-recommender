import { body, param, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to handle validation errors
 */
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

/**
 * Validation rules for authentication endpoints
 */
export const validateLogin = [
  body('username').isString().trim().notEmpty().withMessage('Username is required'),
  body('password').isString().notEmpty().withMessage('Password is required'),
  body('serverUrl').optional().isURL().withMessage('Invalid server URL'),
  handleValidationErrors,
];

/**
 * Validation rules for user action endpoints (watched, watchlist, block)
 * Frontend sends { item: { tmdbId, mediaType, title, ... } }
 */
export const validateUserAction = [
  body('item').isObject().withMessage('Item object is required'),
  body('item.tmdbId').isInt({ min: 1 }).withMessage('TMDB ID must be a positive integer'),
  body('item.mediaType').isIn(['movie', 'tv']).withMessage('Media type must be "movie" or "tv"'),
  body('item.title').optional().isString().trim(),
  body('item.releaseYear').optional().isString().trim(),
  handleValidationErrors,
];

/**
 * Validation rules for recommendation requests
 */
export const validateRecommendationRequest = [
  body('userId').isString().trim().notEmpty().withMessage('User ID is required'),
  body('mediaType').optional().isIn(['movie', 'tv', 'both']).withMessage('Invalid media type'),
  body('genre').optional().isString().trim(),
  handleValidationErrors,
];

/**
 * Validation rules for Jellyfin sync
 */
export const validateJellyfinSync = [
  body('userId').isString().trim().notEmpty().withMessage('User ID is required'),
  body('libraryIds').optional().isArray().withMessage('Library IDs must be an array'),
  handleValidationErrors,
];

/**
 * Validation rules for system config updates
 */
export const validateConfigUpdate = [
  body('jellyfinUrl').optional().isURL().withMessage('Invalid Jellyfin URL'),
  body('jellyseerrUrl').optional().isURL().withMessage('Invalid Jellyseerr URL'),
  body('jellyseerrApiKey').optional().isString().trim(),
  body('tmdbApiKey').optional().isString().trim(),
  body('geminiApiKey').optional().isString().trim(),
  body('geminiModel').optional().isString().trim(),
  handleValidationErrors,
];

/**
 * Validation rules for search queries
 */
export const validateSearch = [
  query('libraryId').optional().isString().trim(),
  query('searchTerm').optional().isString().trim(),
  handleValidationErrors,
];

/**
 * Validation rules for media request
 */
export const validateMediaRequest = [
  // Frontend sends 'mediaId', but we also support 'tmdbId' alias if sent manually
  body().custom((value, { req }) => {
    const id = req.body.mediaId || req.body.tmdbId;
    if (!id || isNaN(Number(id)) || Number(id) <= 0) {
      throw new Error('Valid mediaId or tmdbId is required');
    }
    return true;
  }),
  body('mediaType').isIn(['movie', 'tv']).withMessage('Media type must be "movie" or "tv"'),
  // Title is optional (fetched from TMDB/Jellyseerr if needed)
  handleValidationErrors,
];
