const express = require('express');
const axios = require('axios');
const session = require('cookie-session');
// TODO: add mongo for user key storage
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

// Set up a session middleware to manage session data
// TODO: replace session cookies with mongo
app.use(
  session({
    name: 'webex-session',
    secret: COOKIE_SECRET, // used to sign the session cookie
    maxAge: 12 * 60 * 60 * 1000, // 12 hours
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
    // TODO: save the token in mongo instead of a client-side cookie!!!
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
  req.session = null; // Destroy the session
  res.redirect('/');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});