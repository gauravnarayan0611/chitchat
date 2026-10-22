require('dotenv').config();

const http = require('node:http');
const { randomBytes, randomUUID } = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 8080;
const HISTORY_LIMIT = 100;
const ROOM_ID_PATTERN = /^[A-F0-9]{16}$/;
const mongoUri = process.env.MONGODB_URI;
const createRoomId = () => randomBytes(8).toString('hex').toUpperCase();
const allowedOrigins = new Set(
    (process.env.FRONTEND_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
);
const allowedHosts = [
    'localhost',
    '127.0.0.1',
    'chitchat-frontend-se96.onrender.com'
];

const isAllowedOrigin = origin => {
    if (!origin) {
        return true;
    }

    try {
        const url = new URL(origin);
        return (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
            || (url.protocol === 'https:' && allowedHosts.includes(url.hostname))
            || allowedOrigins.has(url.origin);
    } catch {
        return false;
    }
};

if (!mongoUri) {
    console.error('MONGODB_URI is required. Set it in backend/.env before starting the server.');
    process.exit(1);
}

const mongoClient = new MongoClient(mongoUri);
const httpServer = http.createServer();
const io = new Server(httpServer, {
    cors: {
        origin: (origin, callback) => callback(null, isAllowedOrigin(origin))
    }
});
const users = new Map();

async function startServer() {
    await mongoClient.connect();
    const database = mongoClient.db(process.env.MONGODB_DB || 'chitchat');
    const chatEvents = database.collection('chatEvents');
    const chatRooms = database.collection('chatRooms');
    await chatEvents.createIndex({ room: 1, createdAt: -1 });
    await chatRooms.createIndex({ roomId: 1 }, { unique: true });

    io.on('connection', socket => {
        socket.on('create-room', async acknowledge => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};

            try {
                for (let attempt = 0; attempt < 5; attempt += 1) {
                    const roomId = createRoomId();
                    try {
                        await chatRooms.insertOne({ roomId, createdAt: new Date() });
                        reply({ ok: true, roomId });
                        return;
                    } catch (error) {
                        if (error.code !== 11000) {
                            throw error;
                        }
                    }
                }

                throw new Error('Unable to generate a unique room ID after multiple attempts.');
            } catch (error) {
                console.error('Unable to create a chat room:', error);
                reply({ ok: false, error: 'Unable to create a room right now. Please try again.' });
            }
        });

        socket.on('new-user-joined', async (name, requestedRoomId, acknowledge) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            const userName = typeof name === 'string' ? name.trim().slice(0, 32) : '';
            const roomId = typeof requestedRoomId === 'string' ? requestedRoomId.trim().toUpperCase() : '';
            if (!userName || !ROOM_ID_PATTERN.test(roomId)) {
                reply({ ok: false, error: 'Enter a valid name and 16-character room ID.' });
                return;
            }
            if (users.has(socket.id) || socket.data.joining) {
                reply({ ok: false, error: 'You have already joined a chat room.' });
                return;
            }

            socket.data.joining = true;
            try {
                const room = await chatRooms.findOne({ roomId });
                if (!room) {
                    reply({ ok: false, error: 'Room ID not found. Create a room or check the ID.' });
                    return;
                }

                const history = await chatEvents
                    .find({ room: roomId })
                    .sort({ createdAt: -1, _id: -1 })
                    .limit(HISTORY_LIMIT)
                    .toArray();

                const event = {
                    room: roomId,
                    type: 'join',
                    name: userName,
                    createdAt: new Date()
                };
                const { insertedId } = await chatEvents.insertOne(event);
                event.id = insertedId.toString();
                users.set(socket.id, { name: userName, roomId });
                await socket.join(roomId);
                socket.emit('chat-history', history.reverse().map(({ _id, ...chatEvent }) => ({
                    ...chatEvent,
                    id: chatEvent.id || _id.toString()
                })));
                socket.to(roomId).emit('user-joined', event);
                reply({ ok: true, event });
            } catch (error) {
                console.error('Unable to load chat history or save room entry:', error);
                reply({ ok: false, error: 'Unable to join the chat right now. Please try again.' });
            } finally {
                socket.data.joining = false;
            }
        });

        socket.on('send', async (message, acknowledge) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            const user = users.get(socket.id);
            if (!user || typeof message !== 'string' || !message.trim()) {
                reply({ ok: false, error: 'Join the chat and enter a message first.' });
                return;
            }

            const event = {
                id: randomUUID(),
                room: user.roomId,
                type: 'message',
                name: user.name,
                message: message.trim(),
                createdAt: new Date()
            };

            try {
                await chatEvents.insertOne(event);
                socket.to(user.roomId).emit('receive', event);
                reply({ ok: true, event });
            } catch (error) {
                console.error('Unable to save chat message:', error);
                reply({ ok: false, error: 'Message was not saved. Please try again.' });
            }
        });

        socket.on('delete-message', async (messageId, acknowledge) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            const user = users.get(socket.id);
            if (!user) {
                reply({ ok: false, error: 'Join the chat before deleting messages.' });
                return;
            }
            if (typeof messageId !== 'string' || messageId.length > 36) {
                reply({ ok: false, error: 'Invalid message ID.' });
                return;
            }

            const alternatives = [{ id: messageId }];
            if (/^[a-f\d]{24}$/i.test(messageId)) {
                alternatives.push({ _id: new ObjectId(messageId) });
            }

            try {
                const result = await chatEvents.deleteOne({
                    room: user.roomId,
                    type: 'message',
                    $or: alternatives
                });
                if (result.deletedCount === 0) {
                    reply({ ok: false, error: 'That message no longer exists.' });
                    return;
                }

                io.to(user.roomId).emit('message-deleted', messageId);
                reply({ ok: true });
            } catch (error) {
                console.error('Unable to delete chat message:', error);
                reply({ ok: false, error: 'Unable to delete the message right now.' });
            }
        });

        socket.on('clear-chat', async acknowledge => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            const user = users.get(socket.id);
            if (!user) {
                reply({ ok: false, error: 'Join the chat before clearing it.' });
                return;
            }

            try {
                await chatEvents.deleteMany({ room: user.roomId });
                io.to(user.roomId).emit('chat-cleared');
                reply({ ok: true });
            } catch (error) {
                console.error('Unable to clear chat history:', error);
                reply({ ok: false, error: 'Unable to clear chat history right now.' });
            }
        });

        socket.on('disconnect', async () => {
            const user = users.get(socket.id);
            users.delete(socket.id);
            if (!user) {
                return;
            }

            const event = {
                room: user.roomId,
                type: 'leave',
                name: user.name,
                createdAt: new Date()
            };

            try {
                await chatEvents.insertOne(event);
                io.to(user.roomId).emit('user-left', event);
            } catch (error) {
                console.error('Unable to save room departure:', error);
            }
        });
    });

    httpServer.listen(PORT, () => {
        console.log(`Chat server listening on port ${PORT}`);
    });
}

startServer().catch(error => {
    console.error('Unable to start the chat server. Check your MongoDB connection settings:', error);
    process.exitCode = 1;
});
