const express = require('express');
const router = express.Router();
const axios = require('axios');
const logger = require('../logger');

// used to build the config for axios to make the the API
// endpoint easier to read
const buildHttpPost = (accessToken, roomId, card, fallbackMessage) => {
    // payload
    const data = JSON.stringify({
        roomId: roomId,
        text: fallbackMessage,
        attachments: [
            {
                contentType: "application/vnd.microsoft.card.adaptive",
                content: card
            }
        ]
    });

    // axios config
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

    return config;
}

// ENDPOINT (API): Send a card to the requested roomId
router.post('/', async (req, res) => {
    const { roomId, roomTitle, card, type } = req.body;
    const accessToken = req.session.access_token;
    const email = req.session.email;
    const message = `Card sent by ${req.session.nickName}`;

    logger.info(`/card: ${email} is attempting to send a card to a ${type} space`);

    try {
        // attempt to send the card via Webex
        const config = buildHttpPost(accessToken, roomId, card, message);
        const response = await axios.request(config);

        const messageId = response?.data?.id ?? null;
        if (!messageId) {
            logger.error(`/card: ${email} no messageId returned when sending card`);
        }

        // log the successful card send
        req.db.insertOne({
            email: email,
            activity: 'send card',
            success: true,
            type: type,
            roomId, roomId,
            roomTitle: roomTitle,
            timestamp: new Date(),
            messageId: messageId
        }).then(() => { });

        logger.info(`/card: ${email} sent card successfully`);
        return res.status(200).json(response.data);

    } catch (error) {

        // log the failed card send
        req.db.insertOne({
            email: email,
            activity: 'send card',
            success: false,
            type: type,
            roomId,
            roomTitle: roomTitle,
            timestamp: new Date()
        }).then(() => { });

        logger.error(`/card: ${email} failed to send card: ${error.message}`);
        return res.status(500).json({ message: error.message });
    }
});

// ENDPOINT (API): Delete the specified message by messageId
router.delete('/:id', async (req, res) => {
    const messageId = req.params.id;
    const accessToken = req.session.access_token;
    const email = req.session?.email ?? "user";
    let document;
    
    logger.info(`/card/delete: ${email} is attempting to delete message ${messageId}`);

    try {
        const response = await axios.delete(`https://webexapis.com/v1/messages/${messageId}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        // retrieve roomId and roomTitle from original creation of this message
        const query = { 
            $and: [ 
                {email: email}, 
                {messageId: messageId}, 
                {activity: 'send card'} 
            ]
        };
        document = await req.db.findOne(query).catch(err => {
            logger.error(`/card/delete: ${email} error finding message ${messageId}: ${err}`);
            throw err; // rethrow error to catch below
        });

        // log the successful card send
        await req.db.insertOne({
            email: req.session.email,
            activity: 'delete card',
            success: true,
            roomId: document.roomId,
            roomTitle: document.roomTitle,
            timestamp: new Date(),
            messageId: messageId
        });

        logger.info(`/card: ${email} deleted card successfully`);

        return res.sendStatus(200);     // status of 200 OK
    } catch (error) {

        // log the failed card send
        await req.db.insertOne({
            email: req.session.email,
            activity: 'delete card',
            success: false,
            roomId: document?.roomId,
            roomTitle: document?.roomTitle,
            timestamp: new Date(),
            messageId: messageId
        });

        logger.error(`/card ${email} failed to delete card: ${error.message}: ${messageId}`);
        return res.status(500).json({ message: error.message });
    }
});

// ENDPOINT (API): Get history of card activity
router.get('/', async (req, res) => {
    const email = req.session.email;
    const limit = parseInt(req.query.max) || 25;

    // build Mongo query for current user whose "activity" includes the word "card"
    const query = { $and: [{ email: email }, { activity: { $regex: 'card'} }] };
    const options = {
        projection: { _id: 0, email: 0 },   // return all but email and _id
        sort: { timestamp: -1 },
        limit: limit,
    };

    logger.info(`/card: ${email} attempting to get list of recent cards`);

    // this try/catch will only throw an eror if there is a problem reading the DB
    try {
        const records = await req.db.find(query, options).toArray();
        logger.info(`/card: ${email} retrieved ${records.length} from Mongo successfully`);
        return res.status(200).json(records);

    } catch (error) {
        logger.error(`/card: GET ${error}`);
        return res.status(500).json([]);
    }
});

module.exports = router;