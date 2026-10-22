# Chit-Chat

## Project structure

- `frontend/` contains the browser app, styles, scripts, and static assets.
- `backend/` contains the Node.js chat server and its dependencies.

## Run with MongoDB

The chat server stores room entries, departures, and messages in MongoDB. It
loads the most recent 100 chat events for each person who joins.

1. Install and start MongoDB locally, or create a MongoDB Atlas cluster.
2. Create `backend/.env` and set `MONGODB_URI` to your MongoDB connection
   string. Keep `.env` private; it is ignored by Git.
3. From the `backend` directory, install dependencies and start the server:

   ```sh
   npm install
   npm start
   ```

4. Serve the `frontend` directory on `http://localhost:5500` (for example,
   open `frontend/index.html` with the VS Code Live Server extension).

Create a room in the join dialog and share its 16-character room ID with the
people you want to invite. They can enter that ID to join the same room.
Different room IDs keep chat history and live chat actions separate. Room IDs
act as invite codes: anyone who has an ID can join that room.

For a deployed frontend and backend, set the `chitchat-server-url` meta tag in
`frontend/index.html` to the backend's public HTTPS URL, and set
`FRONTEND_ORIGINS` in `backend/.env` to the frontend's full origin (for example,
`https://your-chat-site.example`). Locally, the app uses `http://localhost:8080`.

Rooms and chat events are stored in the `chatRooms` and `chatEvents`
collections in the database named by `MONGODB_DB` (default: `chitchat`). Each
event has a room, type (`join`, `message`, or `leave`), display name, and
timestamp; message events also include the message text. Any connected
participant can delete an individual message or clear the history for their
room; these actions also delete the matching MongoDB records. Names are
supplied by chat participants and are not verified accounts.
