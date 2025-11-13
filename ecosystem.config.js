module.exports = {
  apps: [
    {
      name: 'broteam-translate-bot',
      script: 'dist/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        DRY_RUN: '0'
      },
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '300M',
      time: true
    }
  ]
};
