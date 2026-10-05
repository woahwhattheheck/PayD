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
  exit?: (code: number) => void;
}

async function drainHttpServer(
  server: Server,
  logger: ShutdownLogger,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };

    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        logger.error('HTTP server close failed', { error });
      }
      finish();
    });

    const timeout = setTimeout(() => {
      logger.warn(`HTTP drain exceeded ${timeoutMs}ms; closing remaining connections`);
      server.closeAllConnections();
      finish();
    }, timeoutMs);
  });
}

export function createGracefulShutdown({
  server,
  logger,
  stopBackgroundWork,
  closeDependencies,
  timeoutMs = 30_000,
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

      try {
        await stopBackgroundWork();
      } catch (error) {
        logger.error('Failed to stop background work cleanly', { error });
      }

      await httpDrain;

      try {
        await closeDependencies();
      } catch (error) {
        logger.error('Failed to close one or more runtime dependencies', { error });
      }

      logger.info('Graceful shutdown complete');
      exit(0);
    })();

    return shutdownPromise;
  };
}
