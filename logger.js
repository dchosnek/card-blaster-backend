const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, errors } = format;
const DailyRotateFile = require('winston-daily-rotate-file');

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level}: ${stack || message}`;
});

// Determine the environment (default to 'production')
const env = process.env.NODE_ENV || 'production';

// Configure transports (always log to file)
// const loggerTransports = [
//   new transports.File({ filename: 'logs/app.log' }),  // Always log to file
// ];

// Daily rotation transport configuration
const rotateTransport = new DailyRotateFile({
  filename: 'logs/app-%DATE%.log', // Log file naming with date
  datePattern: 'YYYY-MM-DD', // Rotate daily
  maxSize: '20m', // Max size of each log file (e.g., 20MB)
  maxFiles: '14d', // Keep logs for 14 days
  zippedArchive: true, // Compress older logs
});

const loggerTransports = [rotateTransport]; // Always log to file

// Add console logging only in development
if (env === 'development') {
  loggerTransports.push(
    new transports.Console({
      format: combine(
        format.colorize(),  // Colorize console logs for better visibility
        logFormat
      ),
    })
  );
}

// Create and configure the logger
const logger = createLogger({
  level: 'info', // Default log level
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }), // Include stack trace for errors
    logFormat
  ),
  transports: loggerTransports,
});

module.exports = logger; // Export the logger for use across the app