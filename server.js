const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Railway assigns a dynamic PORT environment variable
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const activeBots = new Map();

io.on('connection', (socket) => {
    // 1. Deploy Bots Handler
    socket.on('deploy_bots', (data) => {
        const { serverIp, serverPort, botPassword, proxies, count } = data;
        
        for (let i = 0; i < count; i++) {
            const botId = `Bot_${Math.floor(1000 + Math.random() * 9000)}`;
            const proxyUrl = proxies.length > 0 ? proxies[i % proxies.length] : null;
            
            createBot(botId, serverIp, parseInt(serverPort), botPassword, proxyUrl, socket);
        }
    });

    // 2. Chat Handler
    socket.on('send_chat', ({ botId, message }) => {
        const bot = activeBots.get(botId);
        if (bot) bot.chat(message);
    });

    // 3. Movement Handler
    socket.on('move_bot', ({ botId, direction, state }) => {
        const bot = activeBots.get(botId);
        if (bot && bot.entity) {
            bot.setControlState(direction, state);
        }
    });

    // 4. Stop Bot Handler
    socket.on('stop_bot', (botId) => {
        const bot = activeBots.get(botId);
        if (bot) {
            bot.quit();
            activeBots.delete(botId);
        }
    });
});

function createBot(username, host, port, password, proxyUrl, socket) {
    let agent = null;

    if (proxyUrl && proxyUrl.trim() !== '') {
        try {
            // Handles SOCKS4/5, IPv4, IPv6, and auth credentials
            agent = new SocksProxyAgent(proxyUrl.trim());
        } catch (err) {
            socket.emit('bot_log', { botId: username, text: `Proxy Setup Error: ${err.message}` });
        }
    }

    const botOptions = {
        host: host,
        port: port,
        username: username,
        auth: 'offline'
    };

    if (agent) {
        botOptions.agent = agent;
    }

    const bot = mineflayer.createBot(botOptions);
    activeBots.set(username, bot);

    let startTime = Date.now();
    let uptimeInterval;

    uptimeInterval = setInterval(() => {
        if (activeBots.has(username)) {
            const seconds = Math.floor((Date.now() - startTime) / 1000);
            socket.emit('bot_uptime', { botId: username, uptime: seconds });
        } else {
            clearInterval(uptimeInterval);
        }
    }, 1000);

    // Auto /register and /login on spawn
    bot.on('spawn', () => {
        socket.emit('bot_status', { botId: username, status: 'Online' });
        socket.emit('bot_log', { botId: username, text: 'Connected. Sending login commands...' });

        setTimeout(() => {
            bot.chat(`/register ${password} ${password}`);
            bot.chat(`/login ${password}`);
        }, 1500);
    });

    // Chat monitoring
    bot.on('message', (jsonMsg) => {
        const text = jsonMsg.toString();
        socket.emit('bot_chat', { botId: username, message: text });
    });

    // Disconnect and auto-reconnect
    bot.on('end', (reason) => {
        socket.emit('bot_status', { botId: username, status: 'Disconnected' });
        socket.emit('bot_log', { botId: username, text: `Disconnected (${reason}). Reconnecting in 5s...` });
        clearInterval(uptimeInterval);
        activeBots.delete(username);

        setTimeout(() => {
            createBot(username, host, port, password, proxyUrl, socket);
        }, 5000);
    });

    bot.on('error', (err) => {
        socket.emit('bot_log', { botId: username, text: `Error: ${err.message}` });
    });
}

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

