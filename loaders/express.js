const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const logger = require('@utils/logger');

// Routes
const authRoutes = require('@routes/auth.routes');
const chatRoutes = require('@routes/chat.routes');
const presenceRoutes = require('@routes/presence.routes');
const uploadRoutes = require('@routes/upload.routes');

module.exports = (app) => {
  // Middleware
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  
  // HTTP request logging
  app.use(morgan('combined', { stream: logger.stream }));
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  });
  
  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/presence', presenceRoutes);
  app.use('/api/upload', uploadRoutes);
  
  // 404 handler
  app.use((req, res, next) => {
    res.status(404).json({
      success: false,
      message: `Route ${req.originalUrl} not found`,
    });
  });
  
  // Global error handler
  app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal server error';
    
    res.status(statusCode).json({
      success: false,
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  });
  
  logger.info('Express middleware loaded');
};