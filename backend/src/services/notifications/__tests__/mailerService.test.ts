import logger from '../../../utils/logger.js';
import { MailerService } from '../mailerService.js';

jest.mock('../../../utils/logger.js', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock(
  'nodemailer',
  () => ({
    __esModule: true,
    default: {
      createTransport: jest.fn(),
    },
  }),
  { virtual: true },
);

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('MailerService failure logging', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('logs a warning when SMTP is not configured', async () => {
    await MailerService.sendMail({
      to: ['employee@example.com'],
      subject: 'password-reset',
      text: 'body',
    });

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Mailer skipped because SMTP is not configured.',
      {
        recipients: ['employee@example.com'],
        mailType: 'password-reset',
      },
    );
  });

  it('logs nodemailer load failures and preserves the existing no-op behavior', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'mailer@example.com';
    process.env.SMTP_PASS = 'test-pass';

    const loadSpy = jest
      .spyOn(MailerService as any, 'loadNodemailer')
      .mockRejectedValueOnce(new Error('module unavailable'));

    await expect(
      MailerService.sendMail({
        to: ['employee@example.com'],
        subject: 'password-reset',
        text: 'body',
      }),
    ).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Mailer failed to load nodemailer.',
      {
        recipients: ['employee@example.com'],
        mailType: 'password-reset',
        error: 'module unavailable',
      },
    );

    loadSpy.mockRestore();
  });

  it('logs transport initialization failures with recipient and mail type context', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'mailer@example.com';
    process.env.SMTP_PASS = 'test-pass';

    const transportFailure = new Error('transport init failed');
    const nodemailer = (await import('nodemailer')).default as any;
    nodemailer.createTransport.mockImplementationOnce(() => {
      throw transportFailure;
    });

    await expect(
      MailerService.sendMail({
        to: ['employee@example.com'],
        subject: 'password-reset',
        text: 'body',
      }),
    ).rejects.toThrow('transport init failed');

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Mailer failed to send email.',
      {
        recipients: ['employee@example.com'],
        mailType: 'password-reset',
        error: 'transport init failed',
      },
    );
  });

  it('logs send failures with recipient and mail type context, then preserves the failure', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'mailer@example.com';
    process.env.SMTP_PASS = 'test-pass';

    const sendFailure = new Error('provider unavailable');
    const nodemailer = (await import('nodemailer')).default as any;
    nodemailer.createTransport.mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(sendFailure),
    });

    await expect(
      MailerService.sendMail({
        to: ['employee@example.com'],
        subject: 'payroll-notification',
        text: 'body',
      }),
    ).rejects.toThrow('provider unavailable');

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Mailer failed to send email.',
      {
        recipients: ['employee@example.com'],
        mailType: 'payroll-notification',
        error: 'provider unavailable',
      },
    );
  });
});
