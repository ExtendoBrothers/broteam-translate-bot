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
<<<<<<< HEAD
      autorestart: true,
      max_memory_restart: '300M',
=======
      autorestart: false,
      max_memory_restart: '520M',
>>>>>>> de0d211 (feat: stability & humor improvements)
      time: true,
      windowsHide: true,
      kill_timeout: 3000,
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
