const express = require('express');
const axios = require('axios');
const session = require('express-session'); // session middleware
const MongoStore = require('connect-mongo');
const { MongoClient } = require('mongodb');  // native MongoDB client
require('dotenv').config();
const logger = require('./logger');   // import this after reading .env

// Import route files
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const cardRoutes = require('./routes/card');
const systemRoutes = require('./routes/system');

const app = express();
const port = 3000;

const COOKIE_SECRET = process.env.COOKIE_SECRET;

// define MongoDB connection URL and database name
const mongoUrl = 'mongodb://localhost:27017';

MongoClient.connect(mongoUrl)
  .then((client) => {
    logger.info('Connected to MongoDB');

    const activityCollection = client.db('activity-db').collection('activity');

    // Set up session storage using connect-mongo
    app.use(
      session({
        secret: COOKIE_SECRET,        // secret key for signing the session ID cookie
        resave: false,                // prevent session resaving if not modified
        saveUninitialized: true,      // save uninitialized sessions
        store: MongoStore.create({    // create a MongoStore to store session data
          client: client,             // pass the connected MongoClient instance
          dbName: 'session-db',       // optional: specify a database name
          collectionName: 'sessions', // optional: specify a collection name
          ttl: 8 * 60 * 60            // time to live (TTL) for session expiration (in seconds)
        }),
        cookie: { secure: false },    // Set to `true` if using HTTPS
      })
    );

    // ========================================================================
    // Middleware
    // ------------------------------------------------------------------------
    
    // this will help read the body of incoming requests
    // updated the payload size from the default of 100KB to 1MB to support 
    // cards with images as data URIs, which can get large
    app.use(express.json({ limit: '1mb' }));

    // make the activity db available in all routes
    app.use((req, res, next) => {
      req.db = activityCollection; // Attach the db object to the request object
      next();
    });
    
    // ========================================================================
    // Routes
    // ------------------------------------------------------------------------

    // authentication (login, logout, callback)
    app.use('/auth', authRoutes);
    // user API (details, rooms, history)
    app.use('/api/v1/user', userRoutes);
    // card API (/ for send)
    app.use('/api/v1/card', cardRoutes);
    // system API (/ for statistics)
    app.use('/api/v1/system', systemRoutes);

    // Custom error-handling middleware
    app.use((err, req, res, next) => {
      logger.error(`Error handling middleware: ${err.message}`);
      if (err.type === 'entity.too.large') {
        res.status(413).json({
          error: 'Payload too large. Please reduce the size of your JSON payload.',
        });
      } else {
        res.status(500).json({
          error: 'An unexpected error occurred',
        });
      }
    });

    app.listen(port, () => {
      logger.info(`Server is running on http://localhost:${port}`)
    });

  })
  .catch((err) => {
    logger.error('Failed to connect to MongoDB: ', err);
    process.exit(1);
  });