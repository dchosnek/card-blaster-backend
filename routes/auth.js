const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');

// Load environment variables
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const STATE_STRING = process.env.STATE_STRING;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

// ENDPOINT (redirect): Display Webex Oauth page
router.get('/login', (req, res) => {
    const scopes = 'spark:messages_write spark:people_read spark:rooms_read';
    const authUrl = `https://webexapis.com/v1/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${encodeURIComponent(scopes)}&state=${STATE_STRING}`;

    res.redirect(authUrl);
});

// ENDPOINT (redirect): Callback to this API to convert Webex auth code to user token
router.get('/callback', async (req, res) => {
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
        req.db.insertOne({
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
router.get('/logout', (req, res) => {
    // Check if the session exists
    if (req.session) {

        // log the logout event
        req.db.insertOne({
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

module.exports = router;