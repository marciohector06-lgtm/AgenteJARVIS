import winston from "winston";
import "winston-daily-rotate-file";

const fileLogLine = winston.format.printf(
  ({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`
);

const consoleLogLine = winston.format.printf(
  ({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`
);

const fileRotateTransport = new winston.transports.DailyRotateFile({
  dirname: "logs",
  filename: "jarvis-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxFiles: "14d",
});

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), fileLogLine),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        consoleLogLine
      ),
    }),
    fileRotateTransport,
  ],
});
