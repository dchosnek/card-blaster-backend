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
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

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

    // ========================================================================
    // Middleware
    // ------------------------------------------------------------------------
    
    // this will help read the body of incoming requests
    app.use(express.json());
    
    // ========================================================================
    // Oauth
    // ------------------------------------------------------------------------

    // ENDPOINT (redirect): Display Webex Oauth page
    app.get('/login', (req, res) => {
      const scopes = 'spark:messages_write spark:people_read spark:rooms_read';
      const authUrl = `https://webexapis.com/v1/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${encodeURIComponent(scopes)}&state=${STATE_STRING}`;

      res.redirect(authUrl);
    });

    // ENDPOINT (redirect): Callback to this API to convert Webex auth code to user token
    app.get('/callback', async (req, res) => {
      const { code } = req.query;
      const { state } = req.query;

      if (!code) {
        console.error('No authorization code provided in the query string.');
        return res.send('Authorization code missing. Something went wrong with the OAuth flow.');
      }

      if (state !== STATE_STRING) {
        console.error('State string has been tampered with.');
        return res.send('State string has been tampered with. Something went wrong with the OAuth flow.');
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

        // Make a request to Webex API to get the user profile
        const profileResponse = await axios.get('https://webexapis.com/v1/people/me', {
          headers: {
            Authorization: `Bearer ${tokenResponse.data.access_token}`,
          },
        });

        // save the login event to the database in a non-blocking manner
        activityCollection.insertOne({
          email: profileResponse.data.emails[0],
          activity: 'login',
          timestamp: new Date()
        }).then(() => { });

        // save some user data into the session
        req.session.nickName = profileResponse.data.nickName;
        req.session.avatar = profileResponse.data.avatar;
        req.session.email = profileResponse.data.emails[0];

        return res.redirect('http://localhost:4000')

      } catch (error) {
        console.error('Error exchanging code for access token:', error.response ? error.response.data : error.message);
        res.send('An error occurred during the OAuth process. Check the console for details.');
      }
    });

    // ENDPOINT (redirect): Logout of the application
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
          res.clearCookie('connect.sid');

          res.redirect(`${frontendUrl}/`);
        });
      } else {
        res.status(400).send('No session to log out.'); // Handle cases where there is no session
      }
    });

    // ========================================================================
    // API
    // ------------------------------------------------------------------------

    // ENDPOINT (API): Get user status (isAuthenticated, avatar, nickName)
    app.get('/status', async (req, res) => {

      let responseBody;

      // if the session is missing any data, return an empty data structure
      if (!req.session || !req.session.access_token || !req.session.avatar || !req.session.nickName) {
        responseBody = {
          avatarUrl: '',
          isAuthenticated: false,
          nickName: ''
        }
        return res.status(200).json(responseBody);
      } else {
        responseBody = {
          avatarUrl: req.session.avatar,
          isAuthenticated: true,
          nickName: req.session.nickName
        }
        return res.status(200).json(responseBody);
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
        const roomsResponse = await axios.get(
          'https://webexapis.com/v1/rooms?max=500&sortBy=lastactivity', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const rooms = roomsResponse.data.items;
        const filteredRooms = rooms.map(({ id, title, type }) => ({ id, title, type }));

        return res.status(200).json(filteredRooms);
      } catch (error) {
        console.error('Error fetching rooms:', error.response ? error.response.data : error.message);
        return res.status(200).json([])
      }
    });

    // ENDPOINT (API): Send a card to the requested roomId
    app.post('/sendcard', async (req, res) => {
      const { roomId, card, type } = req.body;
      const accessToken = req.session.access_token;
      try {
        const data = JSON.stringify({
          roomId: roomId,
          markdown: "Card could not render",
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: card
            }
          ]
        });
        const config = {
          method: 'post',
          maxBodyLength: Infinity,
          url: 'https://webexapis.com/v1/messages',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
          },
          data: data
        };
        const response = await axios.request(config);

        // log the successful card send
        activityCollection.insertOne({
          email: req.session.email,
          activity: 'send card',
          success: true,
          type: type,
          timestamp: new Date()
        }).then(() => { });

        return res.status(200).json(response.data);
      } catch (error) {

        // log the successful card send
        activityCollection.insertOne({
          email: req.session.email,
          activity: 'send card',
          success: false,
          type: type,
          timestamp: new Date()
        }).then(() => { });

        return res.status(500).json({ error: error.message });
      }
    });

    // ENDPOINT (API): Get history of user activity
    app.get('/history', async (req, res) => {
      try {
        const email = req.session.email;
        const query = { email: email };
        const options = {
          projection: { _id: 0, activity: 1, timestamp: 1, success: 1, type: 1 },
          sort: { timestamp: -1 },
          limit: 25
        };
        const records = await activityCollection.find(query, options).toArray();
        return res.status(200).json(records);

      } catch (error) {
        console.error('Failure querying the database:', error);
        return res.status(200).json([]);
      }
    });

    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });

  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB: ', err);
    process.exit(1);
  });