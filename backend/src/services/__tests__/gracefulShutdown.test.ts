import type { Server } from 'node:http';
import { createGracefulShutdown } from '../gracefulShutdown';

describe('createGracefulShutdown', () => {
  it('drains HTTP before dependency cleanup and exits cleanly', async () => {
    let onClose: (() => void) | undefined;
    const server = {
      close: jest.fn((callback: () => void) => {
        onClose = callback;
        return server;
      }),
      closeAllConnections: jest.fn(),
    } as unknown as Server;
    const stopBackgroundWork = jest.fn();
    const closeDependencies = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const shutdown = createGracefulShutdown({
      server,
      logger,
      stopBackgroundWork,
      closeDependencies,
      exit,
    });

    const pending = shutdown('SIGTERM');
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(stopBackgroundWork).toHaveBeenCalledTimes(1);
    expect(closeDependencies).not.toHaveBeenCalled();

    onClose?.();
    await pending;

    expect(closeDependencies).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('uses the 30 second drain bound before cleanup', async () => {
    jest.useFakeTimers();
    const server = {
      close: jest.fn(() => server),
      closeAllConnections: jest.fn(),
    } as unknown as Server;
    const closeDependencies = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const pending = createGracefulShutdown({
      server,
      logger,
      stopBackgroundWork: jest.fn(),
      closeDependencies,
      exit,
    })('SIGINT');

    await Promise.resolve();
    jest.advanceTimersByTime(30_000);
    await pending;

    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(closeDependencies).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    jest.useRealTimers();
  });

  it('does not close dependencies under failed background work and still exits zero', async () => {
    let onClose: (() => void) | undefined;
    const server = {
      close: jest.fn((callback: () => void) => {
        onClose = callback;
        return server;
      }),
      closeAllConnections: jest.fn(),
    } as unknown as Server;
    const stopBackgroundWork = jest.fn().mockRejectedValue(new Error('stop failed'));
    const closeDependencies = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const pending = createGracefulShutdown({
      server,
      logger,
      stopBackgroundWork,
      closeDependencies,
      exit,
    })('SIGTERM');

    onClose?.();
    await pending;

    expect(logger.error).toHaveBeenCalledWith(
      'Background work shutdown failed',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Runtime dependency cleanup skipped because background work did not stop cleanly'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Graceful shutdown completed with cleanup failures'
    );
    expect(closeDependencies).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('closes dependencies and finishes handled SIGTERM even when server.close throws', async () => {
    const server = {
      close: jest.fn(() => { throw new Error('not listening'); }),
      closeAllConnections: jest.fn(),
    } as unknown as Server;
    const closeDependencies = jest.fn().mockResolvedValue(undefined);
    const stopBackgroundWork = jest.fn();
    const exit = jest.fn();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    await createGracefulShutdown({
      server, logger, stopBackgroundWork, closeDependencies, exit,
    })('SIGTERM');

    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'HTTP server close threw synchronously',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(stopBackgroundWork).toHaveBeenCalledTimes(1);
    expect(closeDependencies).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('keeps dependency cleanup reachable after timed-out force-close throws', async () => {
    jest.useFakeTimers();
    try {
      const server = {
        close: jest.fn(() => server),
        closeAllConnections: jest.fn(() => {
          throw new Error('transport already disconnected');
        }),
      } as unknown as Server;
      const closeDependencies = jest.fn().mockResolvedValue(undefined);
      const exit = jest.fn();
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const pending = createGracefulShutdown({
        server, logger, stopBackgroundWork: jest.fn(),
        closeDependencies, exit, timeoutMs: 30_000,
      })('SIGINT');
      await Promise.resolve();
      jest.advanceTimersByTime(30_000);
      await pending;
      expect(logger.error).toHaveBeenCalledWith(
        'Unable to force-close timed-out HTTP connections',
        expect.objectContaining({ error: expect.any(Error) }),
      );
      expect(closeDependencies).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      jest.useRealTimers();
    }
  });

});
