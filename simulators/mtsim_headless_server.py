#!/usr/bin/env python3
"""
Headless MT-SICS simulator influenced by https://github.com/jonggun33/MTsim.

The upstream project bundles a Tk-based GUI; to avoid graphical dependencies we
re-implement the simulator core here and expose it as a TCP service (MT-SICS
protocol) with an HTTP control API suitable for automated testing.
"""

import argparse
import json
import logging
import re
import socketserver
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict

LOG = logging.getLogger("mtsim.headless")


class MTSICSSimulator:
    """Minimal MT-SICS simulator derived from MTsim's GUI implementation."""

    def __init__(self):
        self.weight = 0.0
        self.tare_value = 0.0
        self.stable = True
        self.pcs_count = 0
        self.display_text = ""

    def set_weight(self, value: float):
        self.weight = round(float(value), 2)

    def set_tare(self, value: float):
        self.tare_value = round(float(value), 2)

    def set_pcs(self, count: int):
        self.pcs_count = max(0, int(count))

    def set_display_text(self, text: str):
        self.display_text = text

    def handle_command(self, command: str) -> str:
        command_upper = command.strip().upper()

        # Handle commands with arguments
        ta_match = re.match(r"TA\s+(\d+\.?\d*)", command_upper)
        d_match = re.match(r"D\s+\"(.+)\"", command_upper)

        if ta_match:
            try:
                value = float(ta_match.group(1))
                self.set_tare(value)
                return "TA A\r\n"
            except ValueError:
                return "EL\r\n" # Logical Error for invalid value
        elif d_match:
            text = d_match.group(1)
            self.set_display_text(text)
            return "D A\r\n"
        elif command_upper == "SI":
            return self._format_response(stable=False)
        elif command_upper == "S":
            return self._format_response(stable=self.stable)
        elif command_upper == "T":
            self.tare_value = self.weight
            return "T A\r\n"
        elif command_upper == "Z":
            self.weight = 0.0
            self.tare_value = 0.0
            return "Z A\r\n"
        elif command_upper == "TA": # For TA without value, return current tare
            return self._format_tare()
        elif command_upper == "TAC":
            self.tare_value = 0.0
            return "TAC A\r\n"
        elif command_upper == "@":
            # Simulate a basic reset acknowledgement
            return "@ A\r\n"
        elif command_upper == "PCS":
            return self._format_pcs()
        elif command_upper == "DW":
            return "DW A\r\n"
        elif command_upper == "?":
            return "I4 MT-SICS Simulator V1.0\r\n"
        elif command_upper == "D": # For D without text, return current display text
            return self._format_display()

        return "ES\r\n"

    def _format_response(self, *, stable: bool) -> str:
        status = "S" if stable else "D"
        net_weight = self.weight - self.tare_value
        return f"S {status} {net_weight:0.2f} g\r\n"

    def _format_tare(self) -> str:
        return f"TA A {self.tare_value:0.2f} g\r\n"

    def _format_pcs(self) -> str:
        count = getattr(self, "pcs_count", 0)
        return f"PCS S {count}\r\n"

    def _format_display(self) -> str:
        return f"D A {self.display_text}\r\n"


class ThreadSafeSimulator:
    """Thread-safe facade around the underlying simulator core."""

    def __init__(self, simulator):
        self._sim = simulator
        self._lock = threading.Lock()
        self._stable = True
        self._last_command = None
        self._last_response = None

    def set_weight(self, weight: float):
        with self._lock:
            self._sim.set_weight(weight)

    def set_stable(self, stable: bool):
        with self._lock:
            self._stable = bool(stable)
            self._sim.stable = self._stable

    def set_tare(self, tare: float):
        with self._lock:
            self._sim.set_tare(tare)

    def set_pcs(self, count: int):
        with self._lock:
            self._sim.set_pcs(count)

    def handle_command(self, command: str) -> str:
        with self._lock:
            response = self._sim.handle_command(command)
            self._last_command = command
            self._last_response = response.strip()
            return response

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            # Access protected state only while locked
            return {
                "weight": self._sim.weight,
                "tare": self._sim.tare_value,
                "stable": self._stable,
                "netWeight": self._sim.weight - self._sim.tare_value,
                "pieces": getattr(self._sim, "pcs_count", 0),
                "lastCommand": self._last_command,
                "lastResponse": self._last_response,
            }


class MtsicsTcpHandler(socketserver.StreamRequestHandler):
    """TCP handler implementing the MT-SICS protocol."""

    greeting = b"MT-SICS Simulator Ready\r\n"

    def __init__(self, sim: ThreadSafeSimulator, *args, **kwargs):
        self._sim = sim
        super().__init__(*args, **kwargs)

    def handle(self):
        client = f"{self.client_address[0]}:{self.client_address[1]}"
        LOG.info("TCP client connected: %s", client)
        try:
            while True:
                data = self.rfile.readline()
                if not data:
                    break
                decoded_data = data.decode("ascii", errors="ignore").strip()
                LOG.info("Received data: %s", decoded_data)
                
                # Process the command using the simulator
                response = self._sim.handle_command(decoded_data)
                
                self.wfile.write(response.encode("ascii")) # Send the simulator's response
                self.wfile.flush()
                LOG.info("Sent response: %r", response.rstrip())
        finally:
            LOG.info("TCP client disconnected: %s", client)


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


class ControlHttpHandler(BaseHTTPRequestHandler):
    """HTTP API to observe and manipulate the simulator state."""

    server_version = "MTsimHeadless/0.1"
    protocol_version = "HTTP/1.1"

    def __init__(self, sim: ThreadSafeSimulator, *args, **kwargs):
        self._sim = sim
        super().__init__(*args, **kwargs)

    # Disable default noisy logging from BaseHTTPRequestHandler
    def log_message(self, format: str, *args) -> None:
        LOG.debug("HTTP %s - %s", self.address_string(), format % args)

    def _write_json(self, payload: Dict[str, Any], status: int = 200):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/") == "/state":
            self._write_json(self._sim.snapshot())
        else:
            self._write_json({"error": "not found"}, status=404)

    def do_POST(self):
        if self.path.rstrip("/") != "/state":
            self._write_json({"error": "not found"}, status=404)
            return

        length_header = self.headers.get("Content-Length")
        try:
            length = int(length_header or "0")
        except ValueError:
            self._write_json({"error": "invalid content length"}, status=400)
            return

        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._write_json({"error": "invalid json payload"}, status=400)
            return

        updated = {}
        if "weight" in body:
            try:
                weight = float(body["weight"])
            except (TypeError, ValueError):
                return self._write_json({"error": "weight must be numeric"}, status=400)
            self._sim.set_weight(weight)
            updated["weight"] = weight
        if "stable" in body:
            stable = bool(body["stable"])
            self._sim.set_stable(stable)
            updated["stable"] = stable
        if "tare" in body:
            try:
                tare = float(body["tare"])
            except (TypeError, ValueError):
                return self._write_json({"error": "tare must be numeric"}, status=400)
            self._sim.set_tare(tare)
            updated["tare"] = tare
        if "pieces" in body:
            try:
                pieces = int(body["pieces"])
            except (TypeError, ValueError):
                return self._write_json({"error": "pieces must be integer"}, status=400)
            self._sim.set_pcs(pieces)
            updated["pieces"] = pieces

        state = self._sim.snapshot()
        state.update(updated)
        self._write_json(state, status=200)


def run_servers(args):
    simulator = ThreadSafeSimulator(MTSICSSimulator())
    simulator.set_stable(not args.unstable)
    simulator.set_weight(args.weight)

    tcp_server = ThreadedTCPServer((args.host, args.port),
                                   lambda *a, **kw: MtsicsTcpHandler(simulator, *a, **kw))
    http_server = ThreadingHTTPServer((args.host, args.http_port),
                                      lambda *a, **kw: ControlHttpHandler(simulator, *a, **kw))

    LOG.info("MT-SICS TCP server listening on %s:%s", args.host, args.port)
    LOG.info("Control API available at http://%s:%s/state", args.host, args.http_port)

    tcp_thread = threading.Thread(target=tcp_server.serve_forever, daemon=True, name="tcp-server")
    http_thread = threading.Thread(target=http_server.serve_forever, daemon=True, name="http-server")
    tcp_thread.start()
    http_thread.start()

    try:
        tcp_thread.join()
        http_thread.join()
    except KeyboardInterrupt:
        LOG.info("Stopping simulator…")
    finally:
        tcp_server.shutdown()
        http_server.shutdown()


def parse_args():
    parser = argparse.ArgumentParser(description="Headless MT-SICS simulator using MTsim.")
    parser.add_argument("--host", default="0.0.0.0", help="Interface to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=4305, help="TCP port for MT-SICS commands")
    parser.add_argument("--http-port", type=int, default=8081,
                        help="HTTP control port for adjusting simulator state")
    parser.add_argument("--weight", type=float, default=0.0,
                        help="Initial weight value reported by the simulator")
    parser.add_argument("--unstable", action="store_true",
                        help="Start the simulator in an unstable state (S command -> S_I)")
    parser.add_argument("--log-level", default="INFO",
                        choices=["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"],
                        help="Logging verbosity")
    return parser.parse_args()


def main():
    args = parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    run_servers(args)


if __name__ == "__main__":
    main()
