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
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';
const approvedDomains = process.env.APPROVED_DOMAINS.split(',');

const getMyDetails = async (token) => {
    try {
        // Make a request to Webex API to get the user profile
        const profileResponse = await axios.get('https://webexapis.com/v1/people/me', {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        return {
            email: profileResponse.data.emails[0],
            nickName: profileResponse.data.nickName,
            avatar: profileResponse.data.avatar,
        }
    } catch (error) {
        return {
            email: null,
            nickName: null,
            avatar: null,
        }
    }
};

// ENDPOINT (redirect): Display Webex Oauth page
router.get('/login', (req, res) => {
    const scopes = 'spark:messages_write spark:people_read spark:rooms_read';
    const authUrl = `https://webexapis.com/v1/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${encodeURIComponent(scopes)}&state=${STATE_STRING}`;

    logger.info(`/login: redirecting to ${authUrl}`);
    logger.info(`/login: redirect_uri=${frontendUrl}`);
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
        logger.info('/callback: obtained access token for the session');

        // save the access token in the session
        req.session.access_token = tokenResponse.data.access_token;

        // Make a request to Webex API to get the user profile
        const profileResponse = await getMyDetails(tokenResponse.data.access_token);

        const email = profileResponse.email;
        logger.info(`/callback: ${email} retrieved profile info from Webex successfully`);

        // confirm this user belongs to an approved domain
        if (!approvedDomains.some(domain => email.endsWith(domain))) {
            throw new Error(`${email} is not part of an approved domain for this app`);
        }

        // save some user data into the session
        req.session.nickName = profileResponse.nickName;
        req.session.avatar = profileResponse.avatar;
        req.session.email = email;
        req.session.bot = false;

        logger.info(`/callback: redirecting to ${frontendUrl}`);
        return res.redirect(`${frontendUrl}`);

    } catch (error) {
        // handle errors from axios or from the thown (simple) errors
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`/callback: failed to exchange code for access token: ${errorMessage}`);
        res.send('An error occurred during the OAuth process.');
    }
});

// ENDPOINT: similar to /callback but access token is provided as request parameter
router.get('/bot/:token', async (req, res) => {
    const accessToken = req.params.token;
    const email = req.session.email;

    logger.info(`/bot: ${email} is attempting to invoke bot mode`);

    // Make a request to Webex API to get the user profile
    const profile = await getMyDetails(accessToken);

    if (profile.email === null) {
        console.error(`/bot: ${email} failed to switch to bot mode; could not retrieve bot details`)
        return res.status(400).json({
            message: 'Invalid or expired bot token.',
          });
    }

    // save the access token in the session
    req.session.access_token = accessToken;
    // save some user data into the session
    req.session.nickName = profile.nickName;
    req.session.avatar = profile.avatar;
    req.session.email = profile.email;
    req.session.bot = true;

    logger.info(`/bot: ${email} is now in bot mode as ${profile.email}`);
    
    return res.status(200).json({
        avatarUrl: profile.avatar,
        isAuthenticated: true,
        nickName: profile.nickName,
        isBot: true,
    });

});

// ENDPOINT (redirect): Logout of the application
router.get('/logout', (req, res) => {
    // Check if the session exists
    if (req.session) {

        // fetch email for logging purposes
        const email = req.session.email;

        // Destroy the session in the MongoDB store
        req.session.destroy((err) => {
            if (err) {
                logger.error('/logout: failed to destroy session:', err);
                return res.status(500).send('Failed to log out. Please try again.');
            }

            logger.info(`/logout: ${email} logged out`);
            // Clear the cookie in the response to fully log out the user
            res.clearCookie('connect.sid');

            res.redirect(`${frontendUrl}`);
        });
    } else {
        logger.warn('/logout: no session to log out.');
        res.status(400).send('No session to log out.'); // Handle cases where there is no session
    }
});

module.exports = router;