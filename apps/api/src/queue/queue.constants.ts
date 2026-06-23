/** Queue names and job names used across the sending engine. */
export const QUEUE_DISPATCH = 'dispatch';
export const QUEUE_SEND = 'send';
export const QUEUE_REPLIES = 'replies';

export const JOB_SCAN = 'scan-due-schedules';
export const JOB_SEND_EMAIL = 'send-email';
export const JOB_POLL_REPLIES = 'poll-replies';

export interface SendEmailJob {
  messageId: string;
}
