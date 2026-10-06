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

  it('logs send failures with recipient and mail type context, then preserves the failure', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'mailer@example.com';
    process.env.SMTP_PASS = 'secret';

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
