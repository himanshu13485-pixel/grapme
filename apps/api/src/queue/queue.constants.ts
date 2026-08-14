/** Queue names and job names used across the sending engine. */
export const QUEUE_DISPATCH = 'dispatch';
export const QUEUE_SEND = 'send';
export const QUEUE_REPLIES = 'replies';
export const QUEUE_ENROLL = 'enroll';
export const QUEUE_LINKEDIN = 'li-outreach'; // LinkedIn channel scheduler (separate engine)

export const JOB_SCAN = 'scan-due-schedules';
export const JOB_SEND_EMAIL = 'send-email';
export const JOB_POLL_REPLIES = 'poll-replies';
export const JOB_RUN_ENROLL = 'run-enrollments';
export const JOB_RUN_AUTO_COHORT = 'run-auto-cohorts';
export const JOB_SEND_REPORTS = 'send-client-reports';
export const JOB_SETUP_NOTIFY = 'setup-notify'; // one staggered reminder channel (email/whatsapp/bell)
export const JOB_RESEND_MESSAGE = 'resend-message'; // re-send one previously-FAILED email in the background

export interface SendEmailJob {
  messageId: string;
}
