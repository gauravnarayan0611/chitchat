const form = document.getElementById('send-container');
const messageInput = document.getElementById('messageInp');
const messageContainer = document.querySelector('.container');
const connectionStatus = document.getElementById('connectionStatus');
const joinForm = document.getElementById('join-form');
const nameDialog = document.getElementById('nameDialog');
const nameInput = document.getElementById('userNameInput');
const roomIdInput = document.getElementById('roomIdInput');
const roomHint = document.getElementById('roomHint');
const joinButton = joinForm.querySelector('button[type="submit"]');
const createRoomButton = document.getElementById('createRoomButton');
const copyRoomButton = document.getElementById('copyRoomButton');
const clearChatButton = document.getElementById('clear-chat');
const messageSound = new Audio('universfield-new-notification-012-363675.mp3');
const ROOM_ID_PATTERN = /^[A-F0-9]{16}$/;
const serverUrlMeta = document.querySelector('meta[name="chitchat-server-url"]');
const configuredServerUrl = serverUrlMeta ? serverUrlMeta.content.trim() : '';
const CHAT_SERVER_URL = configuredServerUrl
    || (['localhost', '127.0.0.1'].includes(window.location.hostname)
        ? 'http://localhost:8080'
        : window.location.origin);
let socket;
let socketInitialization;
let pendingJoin = false;
let pendingName = '';
let pendingRoomId = '';

const playMessageSound = () => {
    messageSound.currentTime = 0;
    const playback = messageSound.play();
    if (playback) {
        playback.catch(error => {
            console.warn('Unable to play the message notification sound:', error);
        });
    }
};

const append = (message, position, messageId) => {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', position);
    const messageText = document.createElement('span');
    messageText.classList.add('message-text');
    messageText.innerText = message;
    messageElement.append(messageText);

    if (messageId) {
        messageElement.dataset.messageId = messageId;
        const deleteButton = document.createElement('button');
        deleteButton.className = 'message-delete';
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.setAttribute('aria-label', 'Delete this message for everyone');
        deleteButton.addEventListener('click', () => {
            if (!socket || !socket.connected) {
                connectionStatus.textContent = 'Not connected. The message was not deleted.';
                return;
            }

            socket.emit('delete-message', messageId, result => {
                if (!result.ok) {
                    connectionStatus.textContent = result.error;
                }
            });
        });
        messageElement.append(deleteButton);
    }

    messageContainer.append(messageElement);
    messageContainer.scrollTo({
        top: messageContainer.scrollHeight,
        behavior: 'smooth'
    });
};

const displayEvent = (event, position) => {
    const time = new Date(event.createdAt).toLocaleTimeString();
    if (event.type === 'message') {
        append(`${time} ${event.name}: ${event.message}`, position, event.id);
    } else if (event.type === 'join') {
        append(`${time} ${event.name} joined the chat`, position);
    } else if (event.type === 'leave') {
        append(`${time} ${event.name} left the chat`, position);
    }
};

const joinRoom = () => {
    if (!pendingJoin || !socket || !socket.connected) {
        return;
    }

    connectionStatus.textContent = 'Connected. Joining chat...';
    pendingJoin = false;
    socket.emit('new-user-joined', pendingName, pendingRoomId, result => {
        joinButton.disabled = false;
        if (!result.ok) {
            connectionStatus.textContent = result.error;
            return;
        }

        pendingName = '';
        pendingRoomId = '';
        nameDialog.hidden = true;
        clearChatButton.hidden = false;
        connectionStatus.textContent = '';
        displayEvent(result.event, 'right');
        messageInput.focus();
    });
};

const initializeSocket = async () => {
    if (socket) {
        return true;
    }

    if (!socketInitialization) {
        socketInitialization = (async () => {
            if (typeof io !== 'function') {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = `${CHAT_SERVER_URL.replace(/\/$/, '')}/socket.io/socket.io.js`;
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Unable to load the chat connection library.'));
                    document.head.append(script);
                });
            }
            if (typeof io !== 'function') {
                throw new Error('The chat connection library did not load.');
            }

            socket = io(CHAT_SERVER_URL);

            socket.on('chat-history', history => {
                messageContainer.replaceChildren();
                history.forEach(chatEvent => displayEvent(chatEvent, 'left'));
            });

            socket.on('user-joined', joinedEvent => {
                displayEvent(joinedEvent, 'left');
            });

            socket.on('user-left', leftEvent => {
                displayEvent(leftEvent, 'left');
            });

            socket.on('receive', chatEvent => {
                displayEvent(chatEvent, 'left');
                playMessageSound();
            });

            socket.on('message-deleted', messageId => {
                const messageElement = [...messageContainer.children]
                    .find(element => element.dataset.messageId === messageId);
                if (messageElement) {
                    messageElement.remove();
                }
            });

            socket.on('chat-cleared', () => {
                messageContainer.replaceChildren();
                connectionStatus.textContent = 'The chat was cleared for everyone.';
            });

            socket.on('connect', () => {
                joinRoom();
            });

            socket.on('connect_error', error => {
                pendingJoin = false;
                joinButton.disabled = false;
                createRoomButton.disabled = false;
                roomHint.textContent = 'Unable to connect to the chat server. Check the server and MongoDB, then try again.';
                connectionStatus.textContent = 'Unable to connect to the chat server. Check the server and MongoDB, then try again.';
                console.error('Unable to connect to the chat server:', error);
            });

            socket.on('disconnect', () => {
                if (nameDialog.hidden) {
                    connectionStatus.textContent = 'Disconnected from chat. Reload the page to reconnect.';
                } else {
                    joinButton.disabled = false;
                    createRoomButton.disabled = false;
                }
            });

            return true;
        })().catch(error => {
            socketInitialization = undefined;
            pendingJoin = false;
            joinButton.disabled = false;
            createRoomButton.disabled = false;
            roomHint.textContent = 'Chat server is not available. Start it with "npm start" in the backend folder, then reload this page.';
            connectionStatus.textContent = error.message;
            console.error('Unable to initialize the chat connection:', error);
            return false;
        });
    }

    return socketInitialization;
};

joinForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase();
    if (!name) {
        nameInput.focus();
        return;
    }
    if (!ROOM_ID_PATTERN.test(roomId)) {
        roomIdInput.setCustomValidity('Enter a valid 16-character room ID.');
        roomIdInput.reportValidity();
        roomIdInput.focus();
        return;
    }

    roomIdInput.setCustomValidity('');
    pendingName = name;
    pendingRoomId = roomId;
    pendingJoin = true;
    joinButton.disabled = true;
    connectionStatus.textContent = 'Connecting to chat...';
<<<<<<< HEAD
    if (!await initializeSocket()) {
        pendingJoin = false;
        return;
    }
    joinRoom();
});
=======
    socket = io('https://chitchat-backend-kbnb.onrender.com');
>>>>>>> 6ce5e77eb36cc4ca28ca57948abb68797131d430

roomIdInput.addEventListener('input', () => {
    roomIdInput.setCustomValidity('');
    copyRoomButton.hidden = true;
    roomHint.textContent = 'Share your room ID with friends so they can join.';
});

createRoomButton.addEventListener('click', async () => {
    createRoomButton.disabled = true;
    roomHint.textContent = 'Connecting to chat server...';
    if (!await initializeSocket()) {
        return;
    }

    roomHint.textContent = 'Creating a room...';
    socket.emit('create-room', result => {
        createRoomButton.disabled = false;
        if (!result.ok) {
            roomHint.textContent = result.error;
            return;
        }

        roomIdInput.value = result.roomId;
        roomIdInput.setCustomValidity('');
        copyRoomButton.hidden = false;
        roomHint.textContent = `Room created. Share this ID with your friends: ${result.roomId}`;
    });
});

copyRoomButton.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(roomIdInput.value);
        roomHint.textContent = 'Room ID copied. Share it with your friends.';
    } catch (error) {
        console.error('Unable to copy the room ID:', error);
        roomHint.textContent = 'Could not copy automatically. Select and copy the room ID.';
    }
});

clearChatButton.addEventListener('click', () => {
    if (!socket || !socket.connected) {
        connectionStatus.textContent = 'Not connected. The chat was not cleared.';
        return;
    }

    if (!window.confirm('Clear all chat history for everyone in the room? This cannot be undone.')) {
        return;
    }

    socket.emit('clear-chat', result => {
        if (!result.ok) {
            connectionStatus.textContent = result.error;
        }
    });
});

form.addEventListener('submit', event => {
    event.preventDefault();
    const message = messageInput.value.trim();
    if (!message || !socket || !socket.connected) {
        return;
    }

    socket.emit('send', message, result => {
        if (!result.ok) {
            connectionStatus.textContent = result.error;
            return;
        }

        displayEvent(result.event, 'right');
        playMessageSound();
        messageInput.value = '';
        messageInput.focus();
    });
});
