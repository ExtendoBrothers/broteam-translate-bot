#!/usr/bin/env node
const http = require('http');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const PORT = 9615;

async function getPM2Data() {
  try {
    const { stdout } = await execPromise('pm2 jlist');
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

async function handleRequest(req, res) {
  if (req.url === '/api/processes') {
    const data = await getPM2Data();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
    return;
  }

  const processes = await getPM2Data();
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>PM2 Dashboard - broteam-translate-bot</title>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: system-ui, sans-serif; margin: 20px; background: #1e1e1e; color: #d4d4d4; }
    h1 { color: #4ec9b0; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; background: #252526; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #3e3e42; }
    th { background: #2d2d30; color: #4ec9b0; font-weight: 600; }
    tr:hover { background: #2a2d2e; }
    .online { color: #89d185; font-weight: 600; }
    .stopped { color: #f48771; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-success { background: #3e7e3a; color: #89d185; }
    .badge-danger { background: #5a1d1d; color: #f48771; }
    code { background: #1e1e1e; padding: 2px 6px; border-radius: 3px; color: #ce9178; }
    .meta { color: #858585; font-size: 14px; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>🚀 PM2 Dashboard</h1>
  <p class="meta">Auto-refreshes every 5 seconds • Local access only • <a href="/api/processes" style="color: #4ec9b0;">JSON API</a></p>
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
    <tbody>
      ${processes.map(p => {
        const uptime = p.pm2_env.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0;
        const statusClass = p.pm2_env.status === 'online' ? 'online' : 'stopped';
        const badgeClass = p.pm2_env.status === 'online' ? 'badge-success' : 'badge-danger';
        return `
          <tr>
            <td>${p.pm_id}</td>
            <td><code>${p.name}</code></td>
            <td><span class="badge ${badgeClass}">${p.pm2_env.status}</span></td>
            <td>${p.pid || 'N/A'}</td>
            <td>${formatUptime(uptime)}</td>
            <td>${p.pm2_env.restart_time || 0}</td>
            <td>${p.monit?.cpu !== undefined ? p.monit.cpu + '%' : 'N/A'}</td>
            <td>${p.monit?.memory !== undefined ? formatBytes(p.monit.memory) : 'N/A'}</td>
          </tr>
        `;
      }).join('')}
    </tbody>
  </table>
  <p class="meta">Last updated: ${new Date().toLocaleString()}</p>
</body>
</html>
  `;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer(handleRequest);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`PM2 Dashboard running at http://127.0.0.1:${PORT}`);
  console.log('Press Ctrl+C to stop');
});
