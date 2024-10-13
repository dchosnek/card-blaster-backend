const express = require('express');
const router = express.Router();
const axios = require('axios');

// ENDPOINT (API): Get user status (isAuthenticated, avatar, nickName)
router.get('/details', async (req, res) => {

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

// ENDPOINT (API): Get history of user activity
router.get('/history', async (req, res) => {
    try {
        const email = req.session.email;
        const query = { email: email };
        const options = {
            projection: { _id: 0, activity: 1, timestamp: 1, success: 1, type: 1 },
            sort: { timestamp: -1 },
            limit: 25
        };
        const records = await req.db.find(query, options).toArray();
        return res.status(200).json(records);

    } catch (error) {
        console.error('Failure querying the database:', error);
        return res.status(200).json([]);
    }
});

// Route to display all rooms the user is connected to
router.get('/rooms', async (req, res) => {
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

module.exports = router;