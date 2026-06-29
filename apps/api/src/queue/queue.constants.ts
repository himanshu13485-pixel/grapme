/** Queue names and job names used across the sending engine. */
export const QUEUE_DISPATCH = 'dispatch';
export const QUEUE_SEND = 'send';
export const QUEUE_REPLIES = 'replies';
export const QUEUE_ENROLL = 'enroll';

export const JOB_SCAN = 'scan-due-schedules';
export const JOB_SEND_EMAIL = 'send-email';
export const JOB_POLL_REPLIES = 'poll-replies';
export const JOB_RUN_ENROLL = 'run-enrollments';
export const JOB_RUN_AUTO_COHORT = 'run-auto-cohorts';

export interface SendEmailJob {
  messageId: string;
}
