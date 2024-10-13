const express = require('express');
const router = express.Router();
const axios = require('axios');

// ENDPOINT (API): Send a card to the requested roomId
router.post('/', async (req, res) => {
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
        req.db.insertOne({
            email: req.session.email,
            activity: 'send card',
            success: true,
            type: type,
            timestamp: new Date()
        }).then(() => { });

        return res.status(200).json(response.data);
    } catch (error) {

        // log the successful card send
        req.db.insertOne({
            email: req.session.email,
            activity: 'send card',
            success: false,
            type: type,
            timestamp: new Date()
        }).then(() => { });

        return res.status(500).json({ error: error.message });
    }
});

module.exports = router;