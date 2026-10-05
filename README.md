# Chit-Chat

## Run with MongoDB

The chat server stores room entries, departures, and messages in MongoDB. It loads
the most recent 100 chat events for each person who joins.

1. Install and start MongoDB locally, or create a MongoDB Atlas cluster.
2. In `nodeServer`, copy `.env.example` to `.env` and set `MONGODB_URI` to your
   MongoDB connection string. Keep `.env` private; it is ignored by Git.
3. From the `nodeServer` directory, install dependencies and start the server:

   ```sh
   npm install
   npm start
   ```

4. Serve the project root on `http://localhost:5500` (for example, with the
   VS Code Live Server extension) and open the page.

Events are stored in the `chatEvents` collection in the database named by
`MONGODB_DB` (default: `chitchat`). Each event has a room, type (`join`,
`message`, or `leave`), display name, and timestamp; message events also include
the message text. Any connected participant can delete an individual message
or clear the entire shared room history; these actions also delete the matching
MongoDB records. Names are supplied by chat participants and are not verified
accounts.
