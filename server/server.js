/**
 * Remote PC Control - Central Server
 *
 * - Serves the web UI on HTTP
 * - Accepts WebSocket connections from both agents (controlled PCs) and browsers
 * - Relays commands from browsers to the target agent and responses back
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT   = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".ico":  "image/x-icon",
};

// ── HTTP server (serves static files) ─────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  const reqPath  = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(PUBLIC, reqPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ct = MIME[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct });
    res.end(data);
  });
});

// ── WebSocket relay ───────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

/** Map of agentId → WebSocket */
const agents   = new Map();
/** Set of browser WebSockets */
const browsers = new Set();

function broadcastMachineList() {
  const msg = JSON.stringify({ type: "machines", list: [...agents.keys()] });
  for (const b of browsers) {
    if (b.readyState === 1) b.send(msg);
  }
}

function sendToBrowsers(raw) {
  for (const b of browsers) {
    if (b.readyState === 1) b.send(raw);
  }
}

wss.on("connection", (ws) => {
  let role    = null;   // "agent" | "browser"
  let agentId = null;

  ws.on("message", (rawBuf) => {
    const raw = rawBuf.toString();
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── First message: registration ──────────────────────────────────────────
    if (role === null) {
      role = msg.role;

      if (role === "agent") {
        agentId = msg.id || `agent-${Date.now()}`;
        agents.set(agentId, ws);
        console.log(`[server] Agent connected: ${agentId}`);
        broadcastMachineList();

      } else if (role === "browser") {
        browsers.add(ws);
        console.log(`[server] Browser connected`);
        // Send current machine list immediately
        ws.send(JSON.stringify({ type: "machines", list: [...agents.keys()] }));

      } else {
        ws.close();
      }
      return;
    }

    // ── Browser → Agent (command routing) ────────────────────────────────────
    if (role === "browser") {
      const target = msg.target;
      if (!target) return;

      const agent = agents.get(target);
      if (!agent || agent.readyState !== 1) {
        ws.send(JSON.stringify({
          type: "error",
          id: target,
          message: `Agent '${target}' is not connected`,
        }));
        return;
      }

      // Forward the full message payload to the agent
      agent.send(JSON.stringify({
        action: msg.action,
        pid:    msg.pid,
        name:   msg.name,
        path:   msg.path,
      }));
    }

    // ── Agent → Browsers (response forwarding) ────────────────────────────────
    if (role === "agent") {
      sendToBrowsers(raw);
    }
  });

  ws.on("close", () => {
    if (role === "agent" && agentId) {
      agents.delete(agentId);
      console.log(`[server] Agent disconnected: ${agentId}`);
      broadcastMachineList();
    } else if (role === "browser") {
      browsers.delete(ws);
      console.log(`[server] Browser disconnected`);
    }
  });

  ws.on("error", (err) => {
    console.error(`[server] WS error (${role}/${agentId}):`, err.message);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
