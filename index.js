require('dotenv').config();

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 8080;
const ROOM = 'main';
const HISTORY_LIMIT = 100;
const mongoUri = process.env.MONGODB_URI;
const isAllowedOrigin = origin => {
    if (!origin) {
        return true;
    }

    try {
        const url = new URL(origin);
        return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    } catch {
        return false;
    }
};

if (!mongoUri) {
    console.error('MONGODB_URI is required. Set it in nodeServer/.env before starting the server.');
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
    await chatEvents.createIndex({ room: 1, createdAt: -1 });

    io.on('connection', socket => {
        socket.on('new-user-joined', async (name, acknowledge) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            const userName = typeof name === 'string' ? name.trim().slice(0, 32) : '';
            if (!userName || users.has(socket.id)) {
                reply({ ok: false, error: 'Enter a valid name to join the chat.' });
                return;
            }

            try {
                const history = await chatEvents
                    .find({ room: ROOM })
                    .sort({ createdAt: -1, _id: -1 })
                    .limit(HISTORY_LIMIT)
                    .toArray();

                const event = {
                    room: ROOM,
                    type: 'join',
                    name: userName,
                    createdAt: new Date()
                };
                const { insertedId } = await chatEvents.insertOne(event);
                event.id = insertedId.toString();
                users.set(socket.id, userName);
                socket.join(ROOM);
                socket.emit('chat-history', history.reverse().map(({ _id, ...chatEvent }) => ({
                    ...chatEvent,
                    id: chatEvent.id || _id.toString()
                })));
                socket.broadcast.emit('user-joined', event);
                reply({ ok: true, event });
            } catch (error) {
                console.error('Unable to load chat history or save room entry:', error);
                reply({ ok: false, error: 'Unable to join the chat right now. Please try again.' });
            }
        });

        socket.on('send', async (message, acknowledge) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            const userName = users.get(socket.id);
            if (!userName || typeof message !== 'string' || !message.trim()) {
                reply({ ok: false, error: 'Join the chat and enter a message first.' });
                return;
            }

            const event = {
                id: randomUUID(),
                room: ROOM,
                type: 'message',
                name: userName,
                message: message.trim(),
                createdAt: new Date()
            };

            try {
                await chatEvents.insertOne(event);
                socket.broadcast.emit('receive', event);
                reply({ ok: true, event });
            } catch (error) {
                console.error('Unable to save chat message:', error);
                reply({ ok: false, error: 'Message was not saved. Please try again.' });
            }
        });

        socket.on('delete-message', async (messageId, acknowledge) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            if (!users.has(socket.id)) {
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
                    room: ROOM,
                    type: 'message',
                    $or: alternatives
                });
                if (result.deletedCount === 0) {
                    reply({ ok: false, error: 'That message no longer exists.' });
                    return;
                }

                io.to(ROOM).emit('message-deleted', messageId);
                reply({ ok: true });
            } catch (error) {
                console.error('Unable to delete chat message:', error);
                reply({ ok: false, error: 'Unable to delete the message right now.' });
            }
        });

        socket.on('clear-chat', async acknowledge => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            if (!users.has(socket.id)) {
                reply({ ok: false, error: 'Join the chat before clearing it.' });
                return;
            }

            try {
                await chatEvents.deleteMany({ room: ROOM });
                io.to(ROOM).emit('chat-cleared');
                reply({ ok: true });
            } catch (error) {
                console.error('Unable to clear chat history:', error);
                reply({ ok: false, error: 'Unable to clear chat history right now.' });
            }
        });

        socket.on('disconnect', async () => {
            const userName = users.get(socket.id);
            users.delete(socket.id);
            if (!userName) {
                return;
            }

            const event = {
                room: ROOM,
                type: 'leave',
                name: userName,
                createdAt: new Date()
            };

            try {
                await chatEvents.insertOne(event);
                socket.broadcast.emit('user-left', event);
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
