const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Ignore /apis/* paths - let Electron handle these
  app.use('/apis', function(req, res, next) {
    next();
  });
}; 