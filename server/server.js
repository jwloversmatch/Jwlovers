const http = require("http");

const createServer = (app) => {
  const httpServer = http.createServer(app);
  
  return { server: app, httpServer };
};

module.exports = { createServer };