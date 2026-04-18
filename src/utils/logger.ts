import winston from 'winston';

const LOG_FILE_PATH = process.env.LOG_FILE_PATH || 'excalidraw.log';
const logLevel = process.env.LOG_LEVEL || 'info';

const logger: winston.Logger = winston.createLogger({
  level: logLevel,

  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.uncolorize(),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    winston.format.printf(info => {
      const extra = info.metadata && Object.keys(info.metadata).length
        ? ` ${JSON.stringify(info.metadata)}`
        : '';
      return `${info.timestamp} [${info.level}] ${info.message}${extra}`
    })
  ),

  transports: [
    new winston.transports.Console({
      level: logLevel,
      stderrLevels: ['warn', 'error']
    }),

    new winston.transports.File({
      filename: LOG_FILE_PATH,
      level: 'debug'
    })
  ]
});

export default logger;