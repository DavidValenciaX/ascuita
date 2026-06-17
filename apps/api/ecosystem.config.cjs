module.exports = {
  apps: [
    {
      name: 'ascuita-api',
      cwd: '/home/ubuntu/ascuita-api',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3000,
      },
    },
  ],
};
