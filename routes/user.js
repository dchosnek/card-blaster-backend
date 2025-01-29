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
            nickName: '',
            isBot: false,
        }
        return res.status(200).json(responseBody);
    } else {
        logger.info(`/details: ${req.session.email} retrieved profile info from Mongo successfully`);
        responseBody = {
            avatarUrl: req.session.avatar,
            isAuthenticated: true,
            nickName: req.session.nickName,
            isBot: req.session.bot,
        }
        return res.status(200).json(responseBody);
    }
});

// ENDPOINT (API): Get history of user activity
router.get('/history', async (req, res) => {
    try {
        const email = req.session.email;
        const limit = parseInt(req.query.max) || 25;
        
        // build the MongoDB query to return ALL activity for the user
        const query = { email: email };
        const options = {
            projection: { _id: 0, email: 0 },   // return all but email and _id
            sort: { timestamp: -1 },
            limit: limit,
        };
        const records = await req.db.find(query, options).toArray();
        logger.info(`/history: ${email} retrieved recent activity from Mongo successfully`);
        return res.status(200).json(records);

    } catch (error) {
        logger.error(`/history: failed to retrieve recent activity from Mongo: ${error.message}`);
        return res.status(500).json({ message: error.message });
    }
});

// Route to display all rooms the user is connected to
router.get('/rooms', async (req, res) => {
    const accessToken = req.session.access_token;
    const email = req.session?.email ?? "user";
    const limit = parseInt(req.query.max) || 500;

    // retrieving a list of rooms from Webex sometimes returns a 502 Bad Gateway,
    // so I had to implement logic for a single retry (it always succeeds on the
    // second attempt)

    // this function could get called twice if the first attempt to get the data
    // from Webex is unsuccessful
    const fetchRooms = async () => {
        try {
            // Make a GET request to Webex to retrieve all rooms
            const roomsResponse = await axios.get(
                `https://webexapis.com/v1/rooms?max=${limit}&sortBy=lastactivity`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
        

            const rooms = roomsResponse.data?.items ?? [];
            const filteredRooms = rooms.map(({ id, title, type }) => ({ id, title, type }));
            logger.info(`/rooms: ${email} received status code of ${roomsResponse.status} from Webex`);
            return { success: true, data: filteredRooms };
        } catch (error) {
            logger.warn(`/rooms: ${email} received status code of ${error.response.status} from Webex`);
            return { success: false, error };
        }
    }

    logger.info(`/rooms: ${email} attempting to retrieve a list of rooms`);

    // this do while loop will call fetchRooms() once if it returns 200 and a
    // max of twice if the first call fails for any reason
    let attempt = 0;
    let response;
    do {
        attempt++;
        response = await fetchRooms();

        if (response.success) break;

    } while (attempt < 2);

    if (response.success) {
        logger.info(`/rooms: ${email} retrieved list of ${response.data.length} rooms`);
        return res.status(200).json(response.data);
    } else {
        const errorMessage = response.error.response
            ? JSON.stringify(response.error.response.data)
            : response.error.message;
        logger.error(`/rooms: ${email} failed to get list of rooms: ${errorMessage}`);
        return res.status(200).json([])
    }
});

module.exports = router;