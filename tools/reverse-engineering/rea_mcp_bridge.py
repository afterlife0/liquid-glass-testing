"""Keep one `rea mcp` stdio server alive and expose it on a Unix socket, so a
single analyzed Ghidra session can answer many tool calls from the shell
(each `rea <command>` CLI call would otherwise re-import and re-analyze).

  REA_SOCK=/tmp/qc.sock python3 rea_mcp_bridge.py serve &          # start
  REA_SOCK=/tmp/qc.sock python3 rea_mcp_bridge.py call open_binary \
      '{"path":"/abs/QuartzCore","provider_id":"ghidra"}'
  REA_SOCK=/tmp/qc.sock python3 rea_mcp_bridge.py call search_strings '{"pattern":"glass"}'
  REA_SOCK=/tmp/qc.sock python3 rea_mcp_bridge.py list | schema TOOL

GHIDRA_INSTALL_DIR / JAVA_HOME are taken from the environment (see `rea doctor`).
"""
import json, os, socket, subprocess, sys, threading

SOCK = os.environ.get("REA_SOCK", "/tmp/rea-mcp.sock")
LOG = SOCK.replace(".sock", ".log")


def serve():
    # Large dylibs take minutes to auto-analyze; give the first query room.
    env = dict(os.environ)
    env.setdefault("REA_GHIDRA_STARTUP_TIMEOUT_MS", "7200000")
    p = subprocess.Popen(["rea", "mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=open(LOG, "ab"), env=env, bufsize=0)
    lock = threading.Lock()
    nid = [0]
    pending = {}

    def reader():
        for line in p.stdout:
            try:
                msg = json.loads(line)
            except Exception:
                continue
            if "id" in msg and msg["id"] in pending:
                pending[msg["id"]]["resp"] = msg
                pending[msg["id"]]["ev"].set()
            else:
                with open(LOG, "a") as f:
                    f.write("notify: " + line.decode()[:2000] + "\n")
    threading.Thread(target=reader, daemon=True).start()

    def rpc(method, params, timeout=None):
        with lock:
            nid[0] += 1
            i = nid[0]
            pending[i] = {"ev": threading.Event()}
            p.stdin.write((json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}) + "\n").encode())
            p.stdin.flush()
        pending[i]["ev"].wait(timeout)
        return pending.pop(i).get("resp", {"error": "timeout"})

    init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                              "clientInfo": {"name": "rea-mcp-bridge", "version": "1"}}, 120)
    with open(LOG, "a") as f:
        f.write("init: " + json.dumps(init)[:2000] + "\n")
    p.stdin.write((json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n").encode())
    p.stdin.flush()

    if os.path.exists(SOCK):
        os.unlink(SOCK)
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.bind(SOCK)
    s.listen(8)

    def handle(c):
        data = b""
        while not data.endswith(b"\n"):
            chunk = c.recv(1 << 20)
            if not chunk:
                break
            data += chunk
        req = json.loads(data)
        resp = rpc(req["method"], req.get("params", {}))
        c.sendall(json.dumps(resp).encode())
        c.close()
    while True:
        c, _ = s.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()


def send(method, params):
    c = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    c.connect(SOCK)
    c.sendall((json.dumps({"method": method, "params": params}) + "\n").encode())
    out = b""
    while True:
        chunk = c.recv(1 << 20)
        if not chunk:
            break
        out += chunk
    return json.loads(out)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "serve":
        serve()
    elif cmd == "list":
        r = send("tools/list", {})
        for t in r["result"]["tools"]:
            print(t["name"], "-", t.get("description", "")[:110].replace("\n", " "))
    elif cmd == "schema":
        r = send("tools/list", {})
        for t in r["result"]["tools"]:
            if t["name"] == sys.argv[2]:
                print(json.dumps(t, indent=1))
    elif cmd == "call":
        args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        r = send("tools/call", {"name": sys.argv[2], "arguments": args})
        res = r.get("result", r)
        if isinstance(res, dict) and "structuredContent" in res:
            print(json.dumps(res["structuredContent"], indent=1))
        elif isinstance(res, dict) and "content" in res:
            for c in res["content"]:
                print(c.get("text", c))
        else:
            print(json.dumps(r, indent=1))
