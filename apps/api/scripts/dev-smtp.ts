/**
 * Local SMTP sink for development — accepts any mail on :2525 and prints a
 * summary (recipient, subject, whether the tracking pixel was injected).
 * Lets you watch a campaign actually "send" with no external mail server.
 *
 *   npx ts-node --transpile-only scripts/dev-smtp.ts
 */
import { SMTPServer } from 'smtp-server';

const server = new SMTPServer({
  authOptional: true,
  // Keep it plaintext-localhost: no STARTTLS (avoids self-signed cert issues),
  // no AUTH advertised (nodemailer then skips login).
  disabledCommands: ['STARTTLS', 'AUTH'],
  onData(stream, session, cb) {
    let raw = '';
    stream.on('data', (c) => (raw += c.toString()));
    stream.on('end', () => {
      const subject = /^subject:\s*(.*)$/im.exec(raw)?.[1]?.trim();
      const hasPixel = /\/t\/open\//.test(raw);
      const hasUnsub = /\/unsubscribe\//.test(raw);
      const to = session.envelope.rcptTo.map((r) => r.address).join(', ');
      // eslint-disable-next-line no-console
      console.log(
        `[smtp-sink] accepted -> to=${to} | subject="${subject}" | pixel=${hasPixel} | unsub=${hasUnsub}`,
      );
      cb();
    });
  },
});

server.listen(2525, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log('Local SMTP sink listening on 127.0.0.1:2525');
});
