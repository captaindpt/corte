const http = require("http");
const { WebSocketServer } = require("ws");
const { createApp } = require("./app");

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer();
const wss = new WebSocketServer({ server, path: "/ws" });

function safeSend(ws, data) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(data));
}

function broadcastState(view) {
  const message = { type: "state", payload: view };
  for (const client of wss.clients) safeSend(client, message);
}

const app = createApp({ onStateChange: broadcastState });
server.on("request", app);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`corte listening on http://localhost:${PORT}`);
});

