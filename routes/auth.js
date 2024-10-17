const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');
const logger = require('../logger');

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

    logger.verbose(`redirecting to ${authUrl}`);
    res.redirect(authUrl);
});

// ENDPOINT (redirect): Callback to this API to convert Webex auth code to user token
router.get('/callback', async (req, res) => {
    // retrieve query params
    const { code, state } = req.query;
    
    try {

        if (!code) {
            throw new Error('No auth code provided in the query string.');
        } else  if (state !== STATE_STRING) {
            throw new Error('State string has been tampered with.');
        }

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
        logger.info('obtained access token for session in callback');

        // save the access token in the session
        req.session.access_token = tokenResponse.data.access_token;

        // Make a request to Webex API to get the user profile
        const profileResponse = await axios.get('https://webexapis.com/v1/people/me', {
            headers: {
                Authorization: `Bearer ${tokenResponse.data.access_token}`,
            },
        });

        const email = profileResponse.data.emails[0]
        logger.info(`${email} retrieved profile info from Webex successfully`);

        // save the login event to the database in a non-blocking manner
        req.db.insertOne({
            email: email,
            activity: 'login',
            timestamp: new Date()
        }).then(() => { });

        // save some user data into the session
        req.session.nickName = profileResponse.data.nickName;
        req.session.avatar = profileResponse.data.avatar;
        req.session.email = email;

        return res.redirect('http://localhost:4000')

    } catch (error) {
        // handle errors from axios or from the thown (simple) errors
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`failed to exchange code for access token in callback: ${errorMessage}`);
        res.send('An error occurred during the OAuth process.');
    }
});

// ENDPOINT (redirect): Logout of the application
router.get('/logout', (req, res) => {
    // Check if the session exists
    if (req.session) {

        // log the logout event
        const email = req.session.email;
        req.db.insertOne({
            email: email,
            activity: 'logout',
            timestamp: new Date()
        }).then(() => { });

        // Destroy the session in the MongoDB store
        req.session.destroy((err) => {
            if (err) {
                logger.error('Failed to destroy session:', err);
                return res.status(500).send('Failed to log out. Please try again.');
            }

            logger.info(`${email} logged out`);
            // Clear the cookie in the response to fully log out the user
            res.clearCookie('connect.sid');

            res.redirect(`${frontendUrl}/`);
        });
    } else {
        logger.warn('No session to log out.');
        res.status(400).send('No session to log out.'); // Handle cases where there is no session
    }
});

module.exports = router;