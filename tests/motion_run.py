#!/usr/bin/env python3
"""Drive tests/motion.html in headless Chrome and print real scroll samples.

Exit 0: assertions passed.
Exit 1: product assertion failed.
Exit 2: browser or harness failed before an assertion.

Preference is emulated with CDP (Emulation.setEmulatedMedia), including a
toggle with no reload. Virtual time is not used: smooth scrolls must paint
intermediate positions.
"""
import base64
import json
import os
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME_CANDIDATES = [
    os.environ.get('CHROME') or '',
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
]


def find_chrome():
    for path in CHROME_CANDIDATES:
        if path and os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def free_port():
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return


def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('socket closed')
        buf += chunk
    return buf


class Cdp:
    def __init__(self, url):
        # ws://127.0.0.1:port/path
        rest = url.split('://', 1)[1]
        hostport, path = rest.split('/', 1)
        host, port = hostport.rsplit(':', 1)
        self.sock = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            'GET /%s HTTP/1.1\r\n'
            'Host: %s\r\n'
            'Upgrade: websocket\r\n'
            'Connection: Upgrade\r\n'
            'Sec-WebSocket-Key: %s\r\n'
            'Sec-WebSocket-Version: 13\r\n\r\n'
        ) % (path, hostport, key)
        self.sock.sendall(req.encode())
        resp = b''
        while b'\r\n\r\n' not in resp:
            resp += self.sock.recv(4096)
        if b' 101 ' not in resp.split(b'\r\n', 1)[0]:
            raise ConnectionError('websocket upgrade failed: ' + resp[:200].decode('utf-8', 'replace'))
        self._id = 0
        self.events = []

    def _send_frame(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        n = len(payload)
        header = bytearray([0x81])
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack('!H', n)
        else:
            header.append(0x80 | 127)
            header += struct.pack('!Q', n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + mask + masked)

    def _read_frame(self):
        while True:
            b0, b1 = recv_exact(self.sock, 2)
            opcode = b0 & 0x0F
            ln = b1 & 0x7F
            if ln == 126:
                ln = struct.unpack('!H', recv_exact(self.sock, 2))[0]
            elif ln == 127:
                ln = struct.unpack('!Q', recv_exact(self.sock, 8))[0]
            data = recv_exact(self.sock, ln) if ln else b''
            if opcode == 0x8:
                raise ConnectionError('websocket closed')
            if opcode == 0x9:
                # pong
                payload = data
                mask = os.urandom(4)
                header = bytearray([0x8A, 0x80 | len(payload)])
                masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                self.sock.sendall(bytes(header) + mask + masked)
                continue
            if opcode in (0x1, 0x0):
                return data.decode()
            # ignore other control frames

    def call(self, method, params=None, session_id=None):
        self._id += 1
        msg = {'id': self._id, 'method': method, 'params': params or {}}
        if session_id:
            msg['sessionId'] = session_id
        self._send_frame(json.dumps(msg))
        while True:
            incoming = json.loads(self._read_frame())
            if incoming.get('id') == self._id:
                if 'error' in incoming:
                    raise RuntimeError(method + ' ' + json.dumps(incoming['error']))
                return incoming.get('result') or {}
            if 'method' in incoming:
                self.events.append(incoming)


def wait_version(port):
    url = 'http://127.0.0.1:%d/json/version' % port
    last = ''
    for _ in range(80):
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                return json.loads(resp.read().decode())
        except Exception as exc:
            last = str(exc)
            time.sleep(0.15)
    raise RuntimeError('devtools did not start (%s)' % last)


def infra(message):
    print('INFRA: ' + message)
    return 2


def main():
    chrome_bin = find_chrome()
    if not chrome_bin:
        return infra('Chrome / Chromium binary not found')
    http_port = free_port()
    debug_port = free_port()
    profile = '/tmp/qp-motion-%d' % debug_port
    os.chdir(ROOT)
    server = ThreadingHTTPServer(('127.0.0.1', http_port), QuietHandler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    chrome_err = []
    chrome = subprocess.Popen(
        [
            chrome_bin, '--headless=new', '--disable-gpu', '--no-sandbox',
            '--disable-dev-shm-usage', '--no-first-run', '--disable-extensions',
            '--disable-background-networking', '--window-size=1000,800',
            '--remote-debugging-port=%d' % debug_port,
            '--user-data-dir=%s' % profile,
            'about:blank',
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    def drain():
        try:
            chrome_err.append(chrome.stderr.read().decode('utf-8', 'replace'))
        except Exception:
            pass

    threading.Thread(target=drain, daemon=True).start()
    failed = False
    try:
        try:
            version = wait_version(debug_port)
        except Exception as exc:
            err = ''.join(chrome_err)[-500:]
            return infra('browser did not open a debug port: %s %s' % (exc, err))
        print('browser: %s' % version.get('Browser', chrome_bin))
        print('binary: %s' % chrome_bin)
        cdp = Cdp(version['webSocketDebuggerUrl'])
        created = cdp.call('Target.createTarget', {'url': 'about:blank'})
        attached = cdp.call('Target.attachToTarget', {'targetId': created['targetId'], 'flatten': True})
        session = attached['sessionId']

        def emul(value):
            features = [{'name': 'prefers-reduced-motion', 'value': value}] if value else []
            cdp.call('Emulation.setEmulatedMedia', {'media': '', 'features': features}, session)

        def run(label, value, expect, navigate):
            nonlocal failed
            emul(value)
            if navigate:
                cdp.call('Page.enable', {}, session)
                cdp.call('Page.navigate', {'url': 'http://127.0.0.1:%d/tests/motion.html' % http_port}, session)
                cdp.call('Runtime.evaluate', {
                    'expression': 'new Promise(r => { if (document.readyState !== "loading") r(); else document.addEventListener("DOMContentLoaded", () => r()); })',
                    'awaitPromise': True,
                }, session)
            evaluated = cdp.call('Runtime.evaluate', {
                'expression': 'window.runMotion(%s)' % json.dumps(expect),
                'awaitPromise': True,
                'returnByValue': True,
            }, session)
            if evaluated.get('exceptionDetails'):
                failed = True
                print('FAIL %s exception %s' % (label, json.dumps(evaluated['exceptionDetails'])[:800]))
                return
            payload = evaluated.get('result', {}).get('value')
            if not isinstance(payload, dict):
                failed = True
                print('FAIL %s no result' % label)
                return
            media = payload.get('media') or {}
            print('== %s expect=%s matchMedia.reduce=%s css=%s ==' % (
                label, expect, media.get('reduce'), media.get('css')))
            for row in payload.get('rows') or []:
                flag = 'PASS' if row.get('ok') else 'FAIL'
                if not row.get('ok'):
                    failed = True
                print('  %s %s kind=%s focus=%s place=%s before=%s afterCalls=%s end=%s travel=%s frames=%s uniq=%s' % (
                    flag, row.get('action'), row.get('kind'), row.get('focus'),
                    row.get('placeOk'), row.get('before'), row.get('afterCalls'),
                    row.get('end'), row.get('travel'), row.get('frames'),
                    json.dumps(row.get('uniq'))))
                if row.get('problems'):
                    print('       ' + '; '.join(row['problems']))

        # Fresh load, preference off, then on.
        run('load preference off', None, 'smooth', True)
        run('load preference reduce', 'reduce', 'instant', True)
        # Same document: off, then reduce, then off again. No reload.
        run('dynamic start off', None, 'smooth', True)
        run('dynamic to reduce', 'reduce', 'instant', False)
        run('dynamic back off', None, 'smooth', False)
    except Exception as exc:
        return infra(str(exc))
    finally:
        chrome.kill()
        try:
            chrome.wait(timeout=5)
        except Exception:
            pass
        server.shutdown()
        try:
            import shutil
            shutil.rmtree(profile, ignore_errors=True)
        except Exception:
            pass
    if failed:
        print('RESULT: FAIL')
        return 1
    print('RESULT: PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
