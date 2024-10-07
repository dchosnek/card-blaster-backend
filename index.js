const express = require('express');
const axios = require('axios');
const session = require('express-session'); // session middleware
const MongoStore = require('connect-mongo');
const { MongoClient } = require('mongodb');  // native MongoDB client
const qs = require('qs');
require('dotenv').config();

const app = express();
const port = 3000;

// Load environment variables
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const STATE_STRING = process.env.STATE_STRING;
const COOKIE_SECRET = process.env.COOKIE_SECRET;

// define MongoDB connection URL and database name
const mongoUrl = 'mongodb://localhost:27017';
const sessionDbName = 'session-db';
const activityDbName = 'activity-db';

MongoClient.connect(mongoUrl)
  .then((client) => {
    console.log('Connected to MongoDB');

    const activityDb = client.db(activityDbName);
    const activityCollection = activityDb.collection('activity');

    // Set up session storage using connect-mongo
    app.use(
      session({
        secret: COOKIE_SECRET,        // secret key for signing the session ID cookie
        resave: false,                // prevent session resaving if not modified
        saveUninitialized: true,      // save uninitialized sessions
        store: MongoStore.create({    // create a MongoStore to store session data
          client: client,             // pass the connected MongoClient instance
          dbName: sessionDbName,      // optional: specify a database name
          collectionName: 'sessions', // optional: specify a collection name
          ttl: 8 * 60 * 60            // time to live (TTL) for session expiration (in seconds)
        }),
        cookie: { secure: false },    // Set to `true` if using HTTPS
      })
    );

    // 1. Home route with a "Log in with Webex" link
    app.get('/', (req, res) => {
      res.send(`
    <h1>Cisco Webex OAuth Demo</h1>
    <a href="/login">Log in with Webex</a>
  `);
    });

    // 2. Login route to redirect user to Webex's OAuth2 page
    app.get('/login', (req, res) => {
      const scopes = 'spark:messages_write spark:people_read spark:rooms_read';
      const authUrl = `https://webexapis.com/v1/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${encodeURIComponent(scopes)}&state=${STATE_STRING}`;

      res.redirect(authUrl);
    });

    // 3. oauth2 callback route to handle Webex's response
    app.get('/callback', async (req, res) => {
      const { code } = req.query;
      const { state } = req.query;

      if (!code) {
        console.error('No authorization code provided in the query string.');
        return res.send('Authorization code missing. Something went wrong with the OAuth flow.');
      }

      if (state !== STATE_STRING) {
        console.error('State string has been tampered with.');
      }

      try {
        // Properly format the data using qs for application/x-www-form-urlencoded content type
        const requestData = qs.stringify({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code,
          redirect_uri: REDIRECT_URI,
        });

        // Make the POST request to exchange authorization code for access token
        const tokenResponse = await axios.post('https://webexapis.com/v1/access_token', requestData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        // save the access token in the session
        req.session.access_token = tokenResponse.data.access_token;
        res.redirect('/profile'); // redirect to the profile page
      } catch (error) {
        console.error('Error exchanging code for access token:', error.response ? error.response.data : error.message);
        res.send('An error occurred during the OAuth process. Check the console for details.');
      }
    });

    // 4. Profile route to get the user's profile from Webex
    app.get('/profile', async (req, res) => {
      const accessToken = req.session.access_token;

      if (!accessToken) {
        return res.redirect('/'); // If no token, redirect to home
      }

      try {
        // Make a request to Webex API to get the user profile
        const profileResponse = await axios.get('https://webexapis.com/v1/people/me', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        // Display the user profile
        const userProfile = profileResponse.data;

        req.session.email = userProfile.emails[0];
        activityCollection.insertOne({
          email: userProfile.emails[0],
          activity: 'login',
          timestamp: new Date()
        }).then(() => { });

        res.send(`
      <h1>Welcome, ${userProfile.displayName}</h1>
      <p>Email: ${userProfile.emails[0]}</p>
      <img src="${userProfile.avatar}" width="200">
      <p><a href="/logout">Logout</a></p>
    `);
      } catch (error) {
        console.error('Error fetching user profile:', error);
        res.send('Error fetching user profile.');
      }
    });

    // Route to display all rooms the user is connected to
    app.get('/rooms', async (req, res) => {
      const accessToken = req.session.access_token;

      if (!accessToken) {
        return res.redirect('/'); // If no token, redirect to home/login
      }

      try {
        // Make a GET request to Webex to retrieve all rooms
        const roomsResponse = await axios.get('https://webexapis.com/v1/rooms', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const rooms = roomsResponse.data.items;

        // Format the room information for display
        let roomsHtml = '<h1>User\'s Webex Spaces</h1><ul><p><a href="/logout">Logout</a></p>';
        rooms.forEach(room => {
          roomsHtml += `<li><strong>${room.title}</strong> (Type: ${room.type}, id: ${room.id})</li>`;
        });
        roomsHtml += '</ul>';

        res.send(roomsHtml);
      } catch (error) {
        console.error('Error fetching rooms:', error.response ? error.response.data : error.message);
        res.send('An error occurred while fetching rooms. Check the console for details.');
      }
    });

    // 5. Logout route to clear the session
    app.get('/logout', (req, res) => {
      // Check if the session exists
      if (req.session) {

        // log the logout event
        activityCollection.insertOne({
          email: req.session.email,
          activity: 'logout',
          timestamp: new Date()
        }).then(() => { });

        // Destroy the session in the MongoDB store
        req.session.destroy((err) => {
          if (err) {
            console.error('Failed to destroy session:', err);
            return res.status(500).send('Failed to log out. Please try again.');
          }

          // Clear the cookie in the response to fully log out the user
          res.clearCookie('connect.sid'); // Replace 'connect.sid' if your session cookie has a custom name

          res.send('Logged out successfully.'); // Send a confirmation response
        });
      } else {
        res.status(400).send('No session to log out.'); // Handle cases where there is no session
      }
    });

    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });

  })
  .catch((err) => {
    console.error('Failed to connect to MondoDB: ', err);
    process.exit(1);
  });