import logger from '../../utils/logger.js';
import { MailerService, SendMailInput } from '../notifications/mailerService.js';

const input: SendMailInput = {
  to: ['employee@example.com'],
  subject: 'Payroll notification',
  text: 'private message body',
};

describe('MailerService failure logging', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'mailer@example.com';
    process.env.SMTP_PASS = 'secret';
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('warns when SMTP is not configured without logging credentials or the message body', async () => {
    delete process.env.SMTP_HOST;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(MailerService.sendMail(input)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith('Mailer is not configured; email was not sent.', {
      recipients: input.to,
      mailType: input.subject,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(input.text);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('logs a nodemailer import failure and preserves the existing no-op behavior', async () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest
      .spyOn(MailerService as any, 'loadNodemailer')
      .mockRejectedValue(new Error('module unavailable'));

    await expect(MailerService.sendMail(input)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('Nodemailer could not be loaded; email was not sent.', {
      recipients: input.to,
      mailType: input.subject,
      error: 'module unavailable',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(input.text);
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
  });

  it('logs an SMTP send failure and rethrows the original error', async () => {
    const sendFailure = new Error('smtp unavailable');
    const sendMail = jest.fn().mockRejectedValue(sendFailure);
    const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    jest.spyOn(MailerService as any, 'loadNodemailer').mockResolvedValue({
      createTransport: jest.fn().mockReturnValue({ sendMail }),
    });

    await expect(MailerService.sendMail(input)).rejects.toBe(sendFailure);

    expect(error).toHaveBeenCalledWith('Mailer failed to send email.', {
      recipients: input.to,
      mailType: input.subject,
      error: 'smtp unavailable',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(input.text);
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
  });
});
