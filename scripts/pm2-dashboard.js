#!/usr/bin/env node
const http = require('http');
const url = require('url');
const fs = require('fs');
const pm2 = require('pm2');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const PORT = process.env.PORT ? Number(process.env.PORT) : 9615;

let cachedVersion = null;

async function getVersion() {
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  // First try to get version from git tags
  try {
    const { stdout: gitVersion } = await execPromise('git describe --tags --abbrev=0 2>/dev/null', { windowsHide: true });
    const trimmedVersion = gitVersion.trim();
    if (trimmedVersion && trimmedVersion.startsWith('v')) {
      cachedVersion = trimmedVersion.substring(1); // Remove 'v' prefix
      return cachedVersion;
    }
  } catch (error) {
    // Git command failed, fall back to package.json
  }

  // Fall back to package.json
  try {
    const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
    cachedVersion = packageJson.version || 'unknown';
    return cachedVersion;
  } catch (error) {
    cachedVersion = 'unknown';
    return cachedVersion;
  }
}

async function getPM2Data() {
  const list = await new Promise(resolve => {
    try {
      pm2.connect(err => {
        if (err) return resolve([]);
        pm2.list((err2, data) => {
          try { pm2.disconnect(); } catch (_) {}
          if (err2) return resolve([]);
          resolve(Array.isArray(data) ? data : []);
        });
      });
    } catch (_) {
      resolve([]);
    }
  });
  if (list && list.length) return list;
  try {
    const { stdout } = await execPromise('pm2 jlist', { windowsHide: true });
    return JSON.parse(stdout);
  } catch (err) {
    return [];
  }
}

function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day > 0) return `${day}d ${hr % 24}h`;
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m`;
  return `${sec}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function tailFileSync(filePath, tailBytes = 16384, maxLines = 100) {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - tailBytes);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join('\n');
  } catch (e) {
    return '';
  }
}

function sseWrite(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`data: ${payload}\n\n`);
}

function tailSSE(res, filePath, opts = { tailBytes: 8192 }) {
  let position = 0;
  let watcher = null;
  let reading = false;

  const sendLines = chunk => {
    const str = chunk.toString('utf8');
    str.split(/\r?\n/).forEach(line => {
      if (line.length > 0) sseWrite(res, 'log', line);
    });
  };

  const readFrom = start => {
    if (reading) return;
    reading = true;
    const stream = fs.createReadStream(filePath, { start });
    stream.on('data', chunk => {
      position += chunk.length;
      sendLines(chunk);
    });
    stream.on('end', () => { reading = false; });
    stream.on('error', () => { reading = false; });
  };

  const start = () => {
    fs.stat(filePath, (err, stat) => {
      if (err) {
        sseWrite(res, 'log', `[dashboard] log file not found: ${filePath}`);
        return;
      }
      const tailStart = Math.max(0, stat.size - (opts.tailBytes || 8192));
      position = tailStart;
      readFrom(tailStart);
    });
  };

  watcher = fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
    if (curr.size < prev.size) {
      position = 0;
      readFrom(0);
    } else if (curr.size > position) {
      readFrom(position);
    }
  });

  res.on('close', () => {
    if (watcher) fs.unwatchFile(filePath);
  });

  start();
}

async function handleRequest(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (pathname === '/api/processes') {
    const data = await getPM2Data();
    // Return a sanitized subset to avoid leaking env/paths
    const safe = data.map(p => ({
      pid: p.pid,
      name: p.name,
      pm_id: p.pm_id,
      pm2_env: {
        status: p.pm2_env && p.pm2_env.status,
        pm_uptime: p.pm2_env && p.pm2_env.pm_uptime,
        restart_time: p.pm2_env && p.pm2_env.restart_time,
      },
      monit: {
        cpu: p.monit && p.monit.cpu,
        memory: p.monit && p.monit.memory,
      }
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
    res.end(JSON.stringify(safe, null, 2));
    return;
  }

  if (pathname === '/api/logs/stream') {
    const name = parsed.query.name || 'broteam-translate-bot';
    const type = (parsed.query.type || 'out').toString();
    const data = await getPM2Data();
    const proc = data.find(p => p.name === name);
    if (!proc) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('process not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
    if (typeof res.flushHeaders === 'function') { try { res.flushHeaders(); } catch(_) {} }
    // Send an initial heartbeat to open the stream and keep it alive
    try {
      res.write('retry: 2000\n');
      res.write(': heartbeat\n\n');
    } catch(_) {}
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch(_) {}
    }, 15000);
    const outPath = proc.pm2_env && proc.pm2_env.pm_out_log_path;
    const errPath = proc.pm2_env && proc.pm2_env.pm_err_log_path;
    const redactors = buildRedactors();
    if (type === 'both') {
      sseWrite(res, 'info', `[dashboard] streaming both logs for ${name}`);
      const cleaners = [
        tailSSEWithPrefix(res, outPath, { tailBytes: 16384 }, '[out] ', redactors),
        tailSSEWithPrefix(res, errPath, { tailBytes: 16384 }, '[err] ', redactors),
      ];
      res.on('close', () => {
        try { clearInterval(ping); } catch(_) {}
        cleaners.forEach(fn => { try { fn(); } catch(_) {} });
      });
    } else {
      const logPath = type === 'err' ? errPath : outPath;
      sseWrite(res, 'info', `[dashboard] streaming ${type} logs for ${name}`);
      const cleaner = tailSSEWithPrefix(res, logPath, { tailBytes: 16384 }, type === 'err' ? '[err] ' : '', redactors);
      res.on('close', () => {
        try { clearInterval(ping); } catch(_) {}
        try { cleaner(); } catch(_) {}
      });
    }
    return;
  }

  const processes = await getPM2Data();
  const rows = processes.map(p => {
    const uptime = p.pm2_env && p.pm2_env.pm_uptime ? (Date.now() - p.pm2_env.pm_uptime) : 0;
    const badgeClass = p.pm2_env && p.pm2_env.status === 'online' ? 'badge-success' : 'badge-danger';
    const cpu = p.monit && p.monit.cpu !== undefined ? (p.monit.cpu + '%') : 'N/A';
    const mem = p.monit && p.monit.memory !== undefined ? formatBytes(p.monit.memory) : 'N/A';
    return '<tr>' +
      '<td>' + (p.pm_id ?? '') + '</td>' +
      '<td><code>' + (p.name ?? '') + '</code></td>' +
      '<td><span class="badge ' + badgeClass + '">' + (p.pm2_env ? p.pm2_env.status : 'unknown') + '</span></td>' +
      '<td>' + (p.pid || 'N/A') + '</td>' +
      '<td>' + formatUptime(uptime) + '</td>' +
      '<td>' + ((p.pm2_env && p.pm2_env.restart_time) || 0) + '</td>' +
      '<td>' + cpu + '</td>' +
      '<td>' + mem + '</td>' +
    '</tr>';
  }).join('');
  const bot = processes.find(p => p.name === 'broteam-translate-bot');
  const botOut = bot && bot.pm2_env ? bot.pm2_env.pm_out_log_path : null;
  const fallbackLog = botOut ? tailFileSync(botOut, 16384, 120) : '';
  // Filter out noise from initial logs and reverse for newest-first
  const filteredLog = fallbackLog 
    ? fallbackLog.split('\n')
        .filter(line => !/already processed|skipping tweet/i.test(line))
        .reverse()
        .join('\n')
    : '';
  const escapedLog = filteredLog ? (filteredLog.replace(/&/g,'&amp;').replace(/</g,'&lt;')) : '';
  const version = await getVersion();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>PM2 Dashboard - broteam-translate-bot v${version}</title>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; margin: 20px; background: #1e1e1e; color: #d4d4d4; }
    h1 { color: #4ec9b0; margin-bottom: 8px; }
    .row { display: grid; grid-template-columns: 1fr; gap: 16px; }
    @media (min-width: 1100px) { .row { grid-template-columns: 1fr 1fr; } }
    table { border-collapse: collapse; width: 100%; background: #252526; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #3e3e42; font-size: 14px; }
    th { background: #2d2d30; color: #4ec9b0; font-weight: 600; position: sticky; top: 0; }
    tr:hover { background: #2a2d2e; }
    .badge { padding: 2px 6px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-success { background: #3e7e3a; color: #89d185; }
    .badge-danger { background: #5a1d1d; color: #f48771; }
    code { background: #1e1e1e; padding: 1px 4px; border-radius: 3px; color: #ce9178; }
    .meta { color: #858585; font-size: 13px; margin: 8px 0 16px; }
    .card { background: #252526; border: 1px solid #3e3e42; border-radius: 6px; overflow: hidden; }
    .card h2 { margin: 0; padding: 10px; font-size: 16px; background: #2d2d30; color: #4ec9b0; }
    .controls { padding: 8px 10px; background: #1e1e1e; border-bottom: 1px solid #3e3e42; display: flex; gap: 8px; align-items: center; }
    .controls label { font-size: 13px; color: #c5c5c5; }
    .controls select, .controls button { background: #2d2d30; color: #d4d4d4; border: 1px solid #3e3e42; border-radius: 4px; padding: 6px 8px; font-size: 13px; }
    .log { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; white-space: pre-wrap; padding: 10px; height: 480px; overflow: auto; background: #1e1e1e; }
  </style>
</head>
<body>
  <h1>🚀 PM2 Dashboard - v${version}</h1>
  <p class="meta">Local only • Page auto-refreshes every 60s</p>
  <div class="row">
    <div class="card">
      <h2>Processes</h2>
      <div style="max-height: 520px; overflow: auto;">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>PID</th>
              <th>Uptime</th>
              <th>Restarts</th>
              <th>CPU</th>
              <th>Memory</th>
            </tr>
          </thead>
          <tbody id="tbody">${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h2>Live Logs</h2>
      <div class="controls">
        <label>Process:
          <select id="procName"></select>
        </label>
        <label>Type:
          <select id="logType">
            <option value="out" selected>out</option>
            <option value="err">err</option>
            <option value="both">both</option>
          </select>
        </label>
      </div>
      <div class="log" id="log">${escapedLog}</div>
    </div>
  </div>

  <script>
    const tbody = document.getElementById('tbody');
    const procName = document.getElementById('procName');
    const logType = document.getElementById('logType');

    function formatUptime(ms) {
      const sec = Math.floor(ms / 1000);
      const min = Math.floor(sec / 60);
      const hr = Math.floor(min / 60);
      const day = Math.floor(hr / 24);
      if (day > 0) return day + 'd ' + (hr % 24) + 'h';
      if (hr > 0) return hr + 'h ' + (min % 60) + 'm';
      if (min > 0) return min + 'm';
      return sec + 's';
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + 'B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
      return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    }

    async function refreshProcesses() {
      try {
        const res = await fetch('/api/processes');
        const data = await res.json();
        tbody.innerHTML = data.map(p => {
          const uptime = p.pm2_env.pm_uptime ? (Date.now() - p.pm2_env.pm_uptime) : 0;
          const badgeClass = p.pm2_env.status === 'online' ? 'badge-success' : 'badge-danger';
          return '<tr>' +
            '<td>' + p.pm_id + '</td>' +
            '<td><code>' + p.name + '</code></td>' +
            '<td><span class="badge ' + badgeClass + '\">' + p.pm2_env.status + '</span></td>' +
            '<td>' + (p.pid || 'N/A') + '</td>' +
            '<td>' + formatUptime(uptime) + '</td>' +
            '<td>' + (p.pm2_env.restart_time || 0) + '</td>' +
            '<td>' + (p.monit && p.monit.cpu !== undefined ? (p.monit.cpu + '%') : 'N/A') + '</td>' +
            '<td>' + (p.monit && p.monit.memory !== undefined ? formatBytes(p.monit.memory) : 'N/A') + '</td>' +
          '</tr>';
        }).join('');

        const names = data.map(p => p.name);
        const current = procName.value;
        procName.innerHTML = names.map(function(n){ return '<option value="' + n + '\">' + n + '</option>'; }).join('');
        if (!current) {
          const def = names.includes('broteam-translate-bot') ? 'broteam-translate-bot' : names[0];
          if (def) procName.value = def;
        } else {
          procName.value = current;
        }
      } catch (e) { }
    }

    refreshProcesses();
    setInterval(refreshProcesses, 5000);
    // Robust auto-refresh every 60s using JS to avoid meta-refresh hangups
    setTimeout(function(){
      try { window.stop && window.stop(); } catch(_) {}
      location.replace(location.href.split('#')[0]);
    }, 60000);
  </script>
</body>
</html>
  `;

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(html);
}

const server = http.createServer(handleRequest);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`PM2 Dashboard running at http://127.0.0.1:${PORT}`);
});

// Build redaction functions to avoid leaking user paths/tokens
function buildRedactors() {
  const redactors = [];
  try {
    const info = os.userInfo();
    if (info && info.username) {
      const user = info.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('C:\\\\\Users\\\\' + user, 'gi');
      redactors.push(s => s.replace(re, 'C:/Users/[user]'));
    }
  } catch (_) {}
  // Generic token-like sequences (long base64/hex-ish)
  redactors.push(s => s.replace(/[A-Za-z0-9_\-]{24,}/g, '[REDACTED]'));
  return redactors;
}

// Tail with optional prefix and redaction; returns a cleanup function
function tailSSEWithPrefix(res, filePath, opts, prefix = '', redactors = []) {
  if (!filePath) {
    sseWrite(res, 'log', `${prefix}[dashboard] log file path not available`);
    return () => {};
  }
  let position = 0;
  let reading = false;
  const watchers = [];

  const applyRedaction = (line) => redactors.reduce((acc, fn) => {
    try { return fn(acc); } catch(_) { return acc; }
  }, line);

  const sendLines = chunk => {
    const str = chunk.toString('utf8');
    str.split(/\r?\n/).forEach(line => {
      if (!line) return;
      const safe = applyRedaction(line);
      sseWrite(res, 'log', prefix + safe);
    });
  };

  const readFrom = start => {
    if (reading) return;
    reading = true;
    const stream = fs.createReadStream(filePath, { start });
    stream.on('data', chunk => { position += chunk.length; sendLines(chunk); });
    stream.on('end', () => { reading = false; });
    stream.on('error', () => { reading = false; });
  };

  const start = () => {
    try {
      const stat = fs.statSync(filePath);
      const tailStart = Math.max(0, stat.size - (opts.tailBytes || 8192));
      position = tailStart;
      readFrom(tailStart);
    } catch (e) {
      sseWrite(res, 'log', `${prefix}[dashboard] cannot stat log file: ${filePath}`);
    }
  };

  const watcher = (curr, prev) => {
    if (curr.size < prev.size) {
      position = 0; readFrom(0);
    } else if (curr.size > position) {
      readFrom(position);
    }
  };
  fs.watchFile(filePath, { interval: 1000 }, watcher);
  watchers.push(() => fs.unwatchFile(filePath, watcher));
  start();
  return () => { watchers.forEach(fn => { try { fn(); } catch(_) {} }); };
}
