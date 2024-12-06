const express = require('express');
const router = express.Router();
const axios = require('axios');
const multer = require('multer');
const AWS = require('aws-sdk');
const { ObjectId } = require('mongodb');
const logger = require('../logger');

// Configure AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID, // Set your AWS access key ID
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // Set your AWS secret access key
    region: process.env.AWS_REGION, // Set your region
  });


// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory for direct S3 upload
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10 MB
});

// function creates human readable sizes for files; used only for logging
const calculateSize = (bytes) => {
    if (bytes === 0) return '0Bytes';

    const k = 1024;
    const dm = 1;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + sizes[i];
};

// GET route to handle retrieving file list
router.get('/', async (req, res) => {
    const email = req.session.email;
    const limit = parseInt(req.query.max) || 25;

    const query = { $and: [{ email: email }, { activity: 'upload image' }] };
    const options = {
        projection: { _id: 0, email: 0 },   // return all but email and _id
        sort: { timestamp: -1 },
        limit: limit,
    };

    logger.info(`/images: ${email} is attempting to retrieve a list of all images`);

    // this try/catch will only throw an eror if there is a problem reading the DB
    try {
        const imageList = await req.db.find(query, options).toArray();
        logger.info(`/images: ${email} successfully retrieved list of ${imageList.length} images`);
        return res.status(200).json(imageList);

    } catch (error) {
        logger.error(`/images: GET ${error}`);
        return res.status(500).json([]);
    }
});

// POST route to handle file upload
router.post('/', upload.single('photo'), async (req, res) => {
    const email = req.session.email;

    logger.info(`/images: ${email} is attempting to upload a file`);

    try {
        const file = req.file; // Multer stores the file in req.file
        if (!file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        logger.info(`/images: ${email} image "${file.originalname}" is ${calculateSize(file.size)}`);

        // upload the file to S3
        const objectId = new ObjectId();
        const extension = file.originalname.split('.').pop();
        const newFilename = objectId + '.' + extension;
        // S3 upload parameters
        const params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: newFilename,
            Body: file.buffer,          // File data from multer
            ContentType: file.mimetype, // File MIME type
        };
        const s3Response = await s3.upload(params).promise();
        const link = s3Response.Location;

        // log the attempted image upload so we can get an ObjectId
        await req.db.insertOne({
            _id: objectId,
            email: email,
            activity: 'upload image',
            timestamp: new Date(),
            filename: file.originalname,
            link: link
        });
        
        logger.info(`/images: ${email} uploaded "${file.originalname}" to ${link}`);

        // Return the S3 file URL
        res.status(200).json({ fileUrl: link });
    } catch (error) {
        console.error('Error uploading to S3:', error);
        res.status(500).json({ message: 'Failed to upload file.' });
    }
});

module.exports = router;