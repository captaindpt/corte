const { createApp } = require("../app");

const app = createApp();

// Handle WebSocket upgrade requests gracefully on Vercel (WebSockets not supported)
app.get("/ws", (req, res) => {
  // Return 426 Upgrade Required - tells client WS isn't available here
  res.status(426).json({ error: "websocket_not_supported", message: "Use HTTP polling instead" });
});

module.exports = app;

