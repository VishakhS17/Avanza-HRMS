export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

/** Dev adapter. It prints the message and does not open a network connection. */
export async function deliverMail(messages: readonly MailMessage[]): Promise<void> {
  for (const message of messages) {
    console.info(`[mail] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}
