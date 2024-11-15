# MongoDB queries

These are some queries that might come in handy in the future. These are queries I created for API endpoints that I decided not to implement at this time.

## Get last group

Retrieve the last group of rooms the user sent a card to. The query will retrieve all `send card` records whose timestamp is within X seconds of the *last* card sent.

```javascript
const pipeline = [
  { $match:         // cards successfully sent by current user
      {
        $and: [
          { email: `${email}` },
          { activity: "send card" },
          { success: true }
        ]
      }
  },
  { $sort: { timestamp: -1 } }, // sorted in desc order
  { $group:         // returns a single record with all records embedded
      {             // the one record has timestamp of the newest record
        _id: null,
        newest: {
          $first: "$timestamp"
        },
        allRecords: {
          $push: {
            timestamp: "$timestamp",
            roomId: "$roomId",
            roomTitle: "$roomTitle",
            type: "$type"
          }
        }
      }
  },
  { $unwind:        // unwind the embedded records from the previous step
      {
        path: "$allRecords",
        preserveNullAndEmptyArrays: false
      }
  },
  { $match:
      {
        $expr: {
          $gte: [
            "$allRecords.timestamp",
            { $subtract: ["$newest", 3 * 1000] } // (in ms)
          ]
        }
      }
  },
  {
    $replaceRoot:
      {
        newRoot: "$allRecords"
      }
  }
]
```

## Get the most recent rooms

Retrieve the rooms you've messaged most recently. This pipeline will retrieve `limit` number of rooms.

```javascript
// Aggregation pipeline:
// 1. Match records for current user where activity = send card
// 2. Group by roomId and create a lastSend field and save the most recent title for the room
// 3. Sort by the lastSend created in the previous step
// 4. Limit the number of records to "max" or "limit"
// 5. AddFields and Project to to replace _id with id
const pipeline = [
    {
        $match: {
            $and: [
                { email: `${email}` },
                { activity: "send card" }]
        }
    },
    {
        $group: {
            _id: "$roomId",
            lastSend: { $max: "$timestamp" },
            title: { $last: "$roomTitle" }
        }
    },
    { $sort: { lastSend: -1 } },
    { $limit: limit },
    { $addFields: { id: { $toString: "$_id" } } },
    { $project: { _id: 0, id: 1, title: 1  } }
];
```

## Get the most popular rooms

Retrieve the rooms you've messaged the most. This pipeline will retrieve `limit` number of rooms.

```javascript
// Aggregation pipeline:
// 1. Match records for current user where activity = send card
// 2. Group by roomId and create a count and save the most recent title for the room
// 3. Sort by the count created in the previous step
// 4. Limit the number of records to "max" or "limit"
// 5. AddFields and Project to to replace _id with id
const pipeline = [
    {
        $match: {
            $and: [
                { email: `${email}` },
                { activity: "send card" }]
        }
    },
    {
        $group: {
            _id: "$roomId",
            count: { $count: {} },
            title: { $last: "$roomTitle" }
        }
    },
    { $sort: { count: -1 } },
    { $limit: limit },
    { $addFields: { id: { $toString: "$_id" } } },
    { $project: { _id: 0, id: 1, title: 1  } }
];
```