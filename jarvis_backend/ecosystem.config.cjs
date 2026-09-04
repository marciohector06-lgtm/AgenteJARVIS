// Config PM2 pros dois processos do jarvis_backend. São processos Node
// separados de propósito (ver memória do projeto): jarvis-whatsapp cuida do
// canal WhatsApp (client singleton do whatsapp-web.js, inclusive os crons
// proativos que dependem dele — briefing/monitor/followup/weekly);
// jarvis-server é o Express+Socket.io (app, dashboard, satélites, backup).
// Os dois importam o mesmo agent/index.js mas rodam com estado de processo
// independente.
//
// Uso: pm2 start ecosystem.config.cjs
//
// Nota sobre o QR code do WhatsApp: no primeiro boot (sem sessão salva em
// .wwebjs_auth/), o QR só aparece no log do processo, não interativamente.
// Acompanhe com "pm2 logs jarvis-whatsapp" (ou "npm run logs:whatsapp")
// assim que subir pela primeira vez, pra escanear a tempo.
module.exports = {
  apps: [
    {
      name: "jarvis-whatsapp",
      script: "src/bot/whatsapp.js",
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
      out_file: "logs/pm2-whatsapp-out.log",
      error_file: "logs/pm2-whatsapp-error.log",
    },
    {
      name: "jarvis-server",
      script: "src/server.js",
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
      out_file: "logs/pm2-server-out.log",
      error_file: "logs/pm2-server-error.log",
    },
  ],
};
