import type { Server } from 'node:http';

export interface ShutdownLogger {
  info(message: string): unknown;
  warn(message: string): unknown;
  error(message: string, meta?: unknown): unknown;
}

export interface GracefulShutdownOptions {
  server: Server;
  logger: ShutdownLogger;
  stopBackgroundWork: () => void | Promise<void>;
  closeDependencies: () => Promise<void>;
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
  exit?: (code: number) => void;
}

async function drainHttpServer(
  server: Server,
  logger: ShutdownLogger,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve();
    };

    try {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          logger.error('HTTP server close failed', { error });
        }
        finish();
      });
    } catch (error) {
      // A closing/listen-racing server or injected transport can fail before
      // registering the callback. Do not skip dependency shutdown or turn a
      // deliberately handled SIGTERM into an unhandled rejection.
      logger.error('HTTP server close threw synchronously', { error });
      try {
        server.closeAllConnections();
      } catch (forceError) {
        logger.error('Unable to force-close HTTP connections', { error: forceError });
      }
      finish();
    }

    if (!settled) {
      timeout = setTimeout(() => {
        logger.warn(`HTTP drain exceeded ${timeoutMs}ms; closing remaining connections`);
        try {
          server.closeAllConnections();
        } catch (error) {
          // Exceptions inside a timer otherwise escape the drain Promise and
          // crash the process before PostgreSQL/Redis cleanup can run.
          logger.error('Unable to force-close timed-out HTTP connections', { error });
        }
        finish();
      }, timeoutMs);
    }
  });
}

async function runBoundedCleanup(
  label: string,
  cleanup: () => void | Promise<void>,
  timeoutMs: number,
  logger: ShutdownLogger
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      Promise.resolve().then(cleanup),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
    return true;
  } catch (error) {
    logger.error(`${label} failed`, { error });
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createGracefulShutdown({
  server,
  logger,
  stopBackgroundWork,
  closeDependencies,
  timeoutMs = 30_000,
  cleanupTimeoutMs = 10_000,
  exit = (code) => process.exit(code),
}: GracefulShutdownOptions): (signal: NodeJS.Signals) => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;

  return (signal: NodeJS.Signals): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      logger.info(`Received ${signal}; starting graceful shutdown`);

      // server.close() runs immediately inside drainHttpServer, so new HTTP
      // connections are refused before background cleanup begins.
      const httpDrain = drainHttpServer(server, logger, timeoutMs);

      const backgroundStopped = await runBoundedCleanup(
        'Background work shutdown',
        stopBackgroundWork,
        cleanupTimeoutMs,
        logger
      );

      await httpDrain;

      const dependenciesClosed = await runBoundedCleanup(
        'Runtime dependency cleanup',
        closeDependencies,
        cleanupTimeoutMs,
        logger
      );

      const clean = backgroundStopped && dependenciesClosed;
      if (clean) {
        logger.info('Graceful shutdown complete');
      } else {
        logger.error('Graceful shutdown completed with cleanup failures');
      }
      // SIGTERM/SIGINT is an intentionally handled shutdown path. Cleanup
      // failures remain visible above, but the issue contract requires an
      // orderly signal-driven shutdown to terminate with status zero.
      exit(0);
    })();

    return shutdownPromise;
  };
}
