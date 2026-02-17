module.exports = {
  apps: [
    {
      name: 'broteam-translate-bot',
      script: 'dist/src/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        DRY_RUN: '0'
      },
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '520M',
      time: true,
      windowsHide: true,
      kill_timeout: 5000,
      shutdown_with_message: true,
      listen_timeout: 3000,
      // Restart loop prevention
      restart_delay: 3000,        // Wait 3 seconds before restarting
      max_restarts: 10,           // Max 10 restarts within min_uptime window
      min_uptime: '30s',          // Consider unstable if crashes within 30s
      exp_backoff_restart_delay: 100,  // Exponential backoff starting at 100ms
      env_windows: {
        NODE_ENV: 'production',
        DRY_RUN: '0'
      }
    },
    {
      name: 'pm2-dashboard',
      script: 'scripts/pm2-dashboard.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: '9615'
      },
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      time: true,
      windowsHide: true,
      kill_timeout: 3000,
      env_windows: {
        NODE_ENV: 'production',
        PORT: '9615'
      }
    }
  ]
};
