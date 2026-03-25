/**
 * Structured logger for server-side use.
 *
 * In production: JSON-structured output with context fields (tenant_id, message_id, phase).
 * In development: human-readable colored output.
 *
 * SECURITY: never log access_token or any secret values.
 * Log context is scoped to tenant_id and message identifiers only.
 */

type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  tenant_id?: string;
  message_id?: string;
  conversation_id?: string;
  phase?: string;
  [key: string]: unknown;
}

const isProd = process.env.NODE_ENV === 'production';

// ANSI color codes for dev-mode output
const DEV_COLORS: Record<LogLevel, string> = {
  info: '\x1b[36m',  // cyan
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};
const RESET = '\x1b[0m';

function formatDev(level: LogLevel, message: string, context?: LogContext): string {
  const ts = new Date().toISOString();
  const color = DEV_COLORS[level];
  const ctxStr = context ? ' ' + JSON.stringify(context) : '';
  return `${color}[${level.toUpperCase()}]${RESET} ${ts} ${message}${ctxStr}`;
}

function formatProd(level: LogLevel, message: string, context?: LogContext): string {
  return JSON.stringify({
    level,
    ts: new Date().toISOString(),
    message,
    ...context,
  });
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const output = isProd
    ? formatProd(level, message, context)
    : formatDev(level, message, context);

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info: (message: string, context?: LogContext) => log('info', message, context),
  warn: (message: string, context?: LogContext) => log('warn', message, context),
  error: (message: string, context?: LogContext) => log('error', message, context),
};
