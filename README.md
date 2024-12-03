# Card Blaster for Webex backend

Node/Express + Mongo stack for performing oauth with Webex and sending a card on a user's behalf. This is just the backend API. The frontend is another repository.

# Database

This backed requires a database. It was written to use MongoDB with two databases: one for session data and one for activity data.

Session data includes the client session ID and a few basic things about the client: nickname, email, and avatar URL. There is a TTL on the session data that is set to 8 hours, so records are deleted automatically after 8 hours.

Activity data is stored persistently. This allows the user to see what cards they've sent and allows the application itself to track how many unique users have utilized this application (and how many cards they've sent).

# Endpoints

This is the backend, so it's primary purpose is to implement API endpoints that the frontend will access.

## Authentication

### `auth/login`

Part of the oauth process, this endpoint is only responsible for redirecting to an authentication page hosted by Webex. This URL includes:
* Client ID: the id of the Card Blaster Webex integration
* Redirect URI: where the client should be redirected to when authentication is complete.
* Scope: the permissions requested by Card Blaster. These must match the permissions requested when registering Card Blaster as a Webex integration.
* State: this is just a string that the backend (this code) can verify is returned by Webex during the auth process. This is optional, but the code in this repository does validate this string and throw an error if it does not match.

### `auth/callback`

The Webex oauth process sends the client to this URL, where the code in this repo will validate the state string and take the token provided by Webex to request a secret token on behalf of the user.

The code in this repo will take the token provided in this callback along with the client secret (created when registering Card Blaster as a Webex integration) to request an access token that can operate on behalf of the user.

The access token obtained in this step is stored in the session database and has a TTL of 8 hours.

### `auth/logout`

This is a simple endpoint that simply creates an entry in the activity database indicating the user logged out, and removed the user's entry in the session database (which deletes all of their personal data).

## Card

### `card/`

This POST endpoint allows a user to send a card.

This GET endpoint returns a list of cards the user has sent or deleted. An optional query parameter named `max` with a default value of 25 controls how many entries are returned.

### `card/:id`

This DELETE endpoint allows a user to delete the card (message) with the given `messageId`.

## System

### `system/`

This endpoint returns the number of unique users and the total number of cards sent. It utilizes data from the activity database. It returns something like the example below.

```json
{
    "totalUsers": 5,
    "totalCardsSent": 20
}
```

## User

### `user/details`

This endpoint returns very basic information about the current user.

```json
{
    "avatarUrl": "https://myphoto.com",
    "isAuthenticated": true,
    "nickName": "Doron"
}
```

### `user/history`

This is an important endpoint that returns the current user's activity history, including the following events:
* login
* logout
* send card
* delete card

An optional query parameter named `max` with a default value of 25 controls how many entries are returned.

## Images

### `images/`

This POST endpoint uploads the file sent to an S3 bucket and returns the S3 link to that file. The file is renamed in the process but the original filename is saved to the local database. The file is renamed in S3 to match the MongoDB ObjectId assigned to that database entry.

This GET endpoint retrieves a list of images uploaded by the user. An optional query parameter named `max` with a default value of 25 controls how many entries are returned.

# S3 Bucket

This project requires an S3 bucket for publicly hosting images for the user to use in adaptive cards. The file `s3Bucket.yml` in this repository is a CloudFormation template that creates a public S3 bucket and an IAM user with permission to upload new objects to that bucket.
