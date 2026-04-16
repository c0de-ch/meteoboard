const { WebSocketServer } = require('ws');

class WsBroadcaster {
  constructor(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      console.log(`[WS] Client connected (total: ${this.wss.clients.size})`);
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('close', () => {
        console.log(`[WS] Client disconnected (total: ${this.wss.clients.size})`);
      });
    });

    // Heartbeat: detect dead connections every 30s
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    this.wss.clients.forEach((ws) => {
      if (ws.readyState === 1) ws.send(message);
    });
  }

  sendInitialState(ws, currentValues) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'init', data: currentValues }));
    }
  }

  close() {
    clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}

module.exports = WsBroadcaster;
