const express = require('express');
const router = express.Router();
const logger = require('../logger');

// ENDPOINT (API): Return statistics about this platform's usage
router.get('/', async (req, res) => {

    logger.info('/system: retrieve app usage (no auth required for this endpoint)');

    // Mongo aggregation pipeline:
    // 1. Match only records where a card was successfully sent
    // 2. Group by user email and count the number of records found for each
    // 3. Group: users = number of records from previous step (unique emails)
    //           cards = sum of the "cards" field for every record in prev step
    // 4. Project: return every record except the _id field
    const cursor = req.db.aggregate(
        [
            { $match: { activity: 'send card', success: true } },
            {
                $group: {
                    _id: '$email',
                    cards: { $count: {} }
                }
            },
            {
                $group: {
                    _id: null,
                    totalUsers: { $count: {} },
                    totalCardsSent: { $sum: '$cards' }
                }
            },
            {
                $project: { _id: 0 }
            }
        ]
    );

    // there is only one record
    const result = await cursor.next();

    logger.info(`/system: app usage is ${JSON.stringify(result)}`);

    res.json(result);
});

module.exports = router;