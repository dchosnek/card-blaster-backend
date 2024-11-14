const express = require('express');
const router = express.Router();
const axios = require('axios');
const logger = require('../logger');

// ENDPOINT (API): Get user status (isAuthenticated, avatar, nickName)
router.get('/details', async (req, res) => {

    let responseBody;

    // if the session is missing any data, return an empty data structure
    if (!req.session || !req.session.access_token || !req.session.avatar || !req.session.nickName) {
        logger.info('/details: session cookie missing some information');
        logger.info(JSON.stringify(req.session));
        responseBody = {
            avatarUrl: '',
            isAuthenticated: false,
            nickName: ''
        }
        return res.status(200).json(responseBody);
    } else {
        logger.info(`/details: ${req.session.email} retrieved profile info from Mongo successfully`);
        responseBody = {
            avatarUrl: req.session.avatar,
            isAuthenticated: true,
            nickName: req.session.nickName
        }
        return res.status(200).json(responseBody);
    }
});

// ENDPOINT (API): Get history of user activity
router.get('/history', async (req, res) => {
    try {
        const email = req.session.email;
        if (!email) { throw new Error('email missing from session database'); }
        const query = { email: email };
        const options = {
            projection: { _id: 0, email: 0 },   // return all but email and _id
            sort: { timestamp: -1 },
            limit: 25
        };
        const records = await req.db.find(query, options).toArray();
        logger.info(`/history: ${email} retrieved recent activity from Mongo successfully`);
        return res.status(200).json(records);

    } catch (error) {
        logger.error(`/history: failed to retrieve recent activity from Mongo: ${error.message}`);
        return res.status(200).json([]);
    }
});

// Route to display all rooms the user is connected to
router.get('/rooms', async (req, res) => {
    const accessToken = req.session.access_token;
    const email = req.session?.email ?? "user";

    logger.info(`/rooms: ${email} attempting to retrieve a list of rooms`);

    try {
        // Make a GET request to Webex to retrieve all rooms
        const roomsResponse = await axios.get(
            'https://webexapis.com/v1/rooms?max=500&sortBy=lastactivity', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        const rooms = roomsResponse.data?.items ?? [];
        const filteredRooms = rooms.map(({ id, title, type }) => ({ id, title, type }));
        logger.info(`/rooms: ${email} retrieved list of ${rooms.length} rooms`);
        return res.status(200).json(filteredRooms);
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`/rooms: ${email} failed to get list of rooms: ${errorMessage}`);
        return res.status(200).json([])
    }
});

module.exports = router;