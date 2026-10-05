jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

jest.mock('../../../utils/logger.js', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import nodemailer from 'nodemailer';
import logger from '../../../utils/logger.js';
import { MailerService, mailerConfig } from '../mailerService.js';

describe('MailerService failure recovery', () => {
  const previousEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
  };

  beforeAll(() => {
    jest.useFakeTimers();
    process.env.SMTP_HOST = 'smtp.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'payd@test.invalid';
    process.env.SMTP_PASS = 'secret';
    mailerConfig.retryDelayMs = 10;
  });

  afterAll(() => {
    jest.useRealTimers();

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('logs failures, retries exactly three times, and exposes SMTP health', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('SMTP auth failed'));
    const verify = jest.fn().mockRejectedValue(new Error('SMTP auth failed'));

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail,
      verify,
    });

    await MailerService.sendMail({
      to: ['alerts@example.test'],
      subject: 'Payroll alert',
      text: 'body must not be logged',
    });

    expect(sendMail).toHaveBeenCalledTimes(1);

    for (let retry = 0; retry < mailerConfig.maxRetryAttempts; retry += 1) {
      await jest.advanceTimersByTimeAsync(mailerConfig.retryDelayMs);
    }

    expect(sendMail).toHaveBeenCalledTimes(1 + mailerConfig.maxRetryAttempts);

    const health = await MailerService.getHealthStatus();
    expect(health).toEqual({
      status: 'disconnected',
      error: 'SMTP auth failed',
      queuedRetries: 0,
    });

    expect(logger.error).toHaveBeenCalledWith(
      'SMTP delivery failed',
      expect.objectContaining({
        recipients: ['alerts@example.test'],
        subject: 'Payroll alert',
        smtpHost: 'smtp.test',
      })
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Email service is down',
      expect.objectContaining({
        error: 'SMTP auth failed',
      })
    );

    const serializedLogs = JSON.stringify((logger.error as jest.Mock).mock.calls);
    expect(serializedLogs).not.toContain('body must not be logged');
  });
});
