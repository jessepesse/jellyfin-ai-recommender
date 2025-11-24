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
 */
export const validateUserAction = [
  body('userId').isString().trim().notEmpty().withMessage('User ID is required'),
  body('tmdbId').isInt({ min: 1 }).withMessage('TMDB ID must be a positive integer'),
  body('mediaType').isIn(['movie', 'tv']).withMessage('Media type must be "movie" or "tv"'),
  body('title').optional().isString().trim(),
  body('releaseYear').optional().isInt({ min: 1800, max: 2100 }).withMessage('Invalid release year'),
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
  body('tmdbId').isInt({ min: 1 }).withMessage('TMDB ID must be a positive integer'),
  body('mediaType').isIn(['movie', 'tv']).withMessage('Media type must be "movie" or "tv"'),
  body('title').isString().trim().notEmpty().withMessage('Title is required'),
  handleValidationErrors,
];
