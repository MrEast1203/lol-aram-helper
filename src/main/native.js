// Wrapper around helper.ps1: a long-lived PowerShell process that does
// screen capture + Windows OCR, window lookups and LCU process discovery.
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

class NativeHelper {
  constructor(log = console) {
    this.log = log;
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = null;
  }

  scriptPath() {
    // helper.ps1 is unpacked from app.asar so powershell.exe can read it.
    return path.join(__dirname, 'helper.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  }

  start() {
    if (this.proc) return this.ready;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath()], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdin.setDefaultEncoding('utf8');
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => this.onLine(line));
    this.proc.stderr.on('data', (d) => this.log.warn('[helper stderr]', d.toString().trim()));
    this.proc.on('exit', (code) => {
      this.log.warn('[helper] exited', code);
      for (const { reject } of this.pending.values()) reject(new Error('helper exited'));
      this.pending.clear();
      this.proc = null;
      this.ready = null;
    });
    this.ready = this.send({ cmd: 'ping' }, 60000);
    return this.ready;
  }

  onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line.replace(/^﻿/, ''));
    } catch {
      this.log.warn('[helper] bad line', line.slice(0, 200));
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error(msg.error || 'helper error'));
  }

  send(req, timeoutMs = 15000) {
    if (!this.proc) this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`helper timeout: ${req.cmd}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ ...req, id }) + '\n');
    });
  }

  async call(req, timeoutMs) {
    if (!this.proc) this.start();
    await this.ready;
    return this.send(req, timeoutMs);
  }

  ocr(rect, lang, opts = {}) {
    return this.call(
      { cmd: 'ocr', x: rect.x, y: rect.y, w: rect.w, h: rect.h, lang, scale: opts.scale || 1, save: opts.save, file: opts.file, bands: opts.bands, thresholds: opts.thresholds },
      30000
    );
  }
  capture(rect, file) {
    return this.call({ cmd: 'capture', ...rect, save: file });
  }
  findWindow(cls, title) {
    return this.call({ cmd: 'win', cls, title });
  }
  lcuProcess() {
    return this.call({ cmd: 'lcu' }, 20000);
  }
  ocrLanguages() {
    return this.call({ cmd: 'langs' });
  }

  stop() {
    if (this.proc) {
      this.proc.stdin.end();
      this.proc.kill();
      this.proc = null;
    }
  }
}

module.exports = { NativeHelper };
