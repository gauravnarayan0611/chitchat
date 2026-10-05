const form = document.getElementById('send-container');
const messageInput = document.getElementById('messageInp');
const messageContainer = document.querySelector('.container');
const connectionStatus = document.getElementById('connectionStatus');
const joinForm = document.getElementById('join-form');
const nameDialog = document.getElementById('nameDialog');
const nameInput = document.getElementById('userNameInput');
const joinButton = joinForm.querySelector('button[type="submit"]');
const clearChatButton = document.getElementById('clear-chat');
const messageSound = new Audio('universfield-new-notification-012-363675.mp3');
let socket;

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

joinForm.addEventListener('submit', event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.focus();
        return;
    }

    if (typeof io !== 'function') {
        connectionStatus.textContent = 'Chat server is not available. Start it with "npm start" in the nodeServer folder, then reload this page.';
        return;
    }

    joinButton.disabled = true;
    connectionStatus.textContent = 'Connecting to chat...';
    socket = io('http://localhost:8080');

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
        connectionStatus.textContent = 'Connected. Joining chat...';
        socket.emit('new-user-joined', name, result => {
            joinButton.disabled = false;
            if (!result.ok) {
                connectionStatus.textContent = result.error;
                socket.disconnect();
                return;
            }

            nameDialog.hidden = true;
            clearChatButton.hidden = false;
            connectionStatus.textContent = '';
            displayEvent(result.event, 'right');
            messageInput.focus();
        });
    });

    socket.on('connect_error', error => {
        joinButton.disabled = false;
        connectionStatus.textContent = 'Unable to connect to the chat server. Check the server and MongoDB, then try again.';
        console.error('Unable to connect to the chat server:', error);
    });

    socket.on('disconnect', () => {
        if (nameDialog.hidden) {
            connectionStatus.textContent = 'Disconnected from chat. Reload the page to reconnect.';
        }
    });
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
