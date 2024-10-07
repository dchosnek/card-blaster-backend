# Webex Oauth on localhost

Perform the oauth process with Cisco Webex for using a Node server running on localhost.

This code stores the resulting user token in a server-side session record in MongoDB. The session has a TTL and will be automatically deleted by MongoDB once the expiration has been reached.