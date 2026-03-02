# Remote PC Control

A web-based remote administration tool that lets you control multiple machines simultaneously from a browser.

## Requirements

- **Client** — web app running in the browser
- **Server** — relay server + controlled machine agent
- Supports controlling **multiple machines at once**

### Features
- List / Start / Stop **Applications** (windowed)
- List / Start / Stop **Processes** (all)
- **Screenshot** — view the remote screen
- **Keylogger** — capture and retrieve keystrokes
- **Download File** — pull any file from the remote machine
- **Webcam** — live feed (~10 fps)
- **Reboot / Shutdown**

---

## Architecture

```
Browser  ──WebSocket──►  Node.js Server (relay)  ──WebSocket──►  Python Agent (on each VM)
```

- The **agent** runs on each controlled machine and connects *outward* to the server — no inbound firewall rules needed.
- The **server** routes commands from the browser to the correct agent and streams responses back.
- The **browser UI** lists all connected machines; click one to control it.

---

## Project Structure

```
project-3/
├── agent/
│   ├── agent.py          # runs on each controlled machine
│   └── requirements.txt
├── server/
│   ├── server.js         # Node.js relay + HTTP server
│   ├── package.json
│   └── public/           # web UI (HTML + JS)
├── setup-server.sh       # server setup script
└── setup-agent.sh        # agent setup script
```

---

## Installation & Usage

### 1 — Server (host machine)

```bash
./setup-server.sh
```

Opens the web UI at **http://localhost:3000**.

Options:
```
--port 8080       use a custom port
--install-only    install deps without starting
```

### 2 — Agent (each controlled VM)

Copy the project folder to the VM, then:

```bash
./setup-agent.sh --server ws://<host-ip>:3000
```

The agent installs its own Python dependencies, connects to the server, and auto-reconnects if the connection drops.

Options:
```
--server <url>    server WebSocket URL (default: ws://localhost:3000)
--install-only    install deps without starting
```

> **Note:** The `SERVER_URL` environment variable can also be used instead of `--server`.

### 3 — Control

1. Open **http://localhost:3000** in a browser.
2. Connected machines appear in the left sidebar.
3. Click a machine to control it — use the tabs for each feature.

---

## Dependencies

| Side   | Stack                                      |
|--------|--------------------------------------------|
| Server | Node.js, `ws`                              |
| Agent  | Python 3, `websockets`, `psutil`, `Pillow`, `mss`, `pynput`, `opencv-python-headless` |
| Client | Plain HTML / JavaScript (no build step)    |
