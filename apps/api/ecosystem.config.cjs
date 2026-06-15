module.exports = {
  apps: [
    {
      name: 'ascuita-api',
      cwd: '/var/www/ascuita/apps/api',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3001,
      },
    },
  ],
};
