const logger = require('../logger');

// Middleware to check for email and access token in the session
module.exports = function requireEmail(req, res, next) {
    if (req.session?.email && req.session?.access_token) {
      return next();
    }
    logger.error('Email or access token missing from session data.');
    return res.status(401).json({ message: 'You are not authenticated.' });
  }
  