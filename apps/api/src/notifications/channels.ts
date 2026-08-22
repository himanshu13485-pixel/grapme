/**
 * The messaging networks we can reach a user on, and the handful of names that
 * differ per network.
 *
 * Both go out through the same self-hosted portal — one project per network,
 * each with its own number and its own API key — so everything downstream of
 * "which credentials" is identical. Keeping the differences in one table is
 * what lets the portal client, the OTP flow and the settings screen be written
 * once instead of twice.
 */
export type MessagingChannel = 'whatsapp' | 'telegram';

export const MESSAGING_CHANNELS: readonly MessagingChannel[] = ['whatsapp', 'telegram'] as const;

export interface ChannelMeta {
  key: MessagingChannel;
  /** How the network is written in anything a user reads. */
  label: string;
  /** Key under `Tenant.settings` holding this channel's portal credentials. */
  settingsKey: string;
  /** Env fallback, for installs configured entirely through the environment. */
  envUrl: string;
  envApiKey: string;
  /** The user's opt-in flag for this channel. */
  notifyField: 'notifyWhatsapp' | 'notifyTelegram';
  /** When the user last proved the number reaches them on this network. */
  verifiedField: 'whatsappVerifiedAt' | 'telegramVerifiedAt';
}

const META: Record<MessagingChannel, ChannelMeta> = {
  whatsapp: {
    key: 'whatsapp',
    label: 'WhatsApp',
    settingsKey: 'whatsapp',
    envUrl: 'WA_PORTAL_URL',
    envApiKey: 'WA_PORTAL_API_KEY',
    notifyField: 'notifyWhatsapp',
    verifiedField: 'whatsappVerifiedAt',
  },
  telegram: {
    key: 'telegram',
    label: 'Telegram',
    settingsKey: 'telegram',
    envUrl: 'TG_PORTAL_URL',
    envApiKey: 'TG_PORTAL_API_KEY',
    notifyField: 'notifyTelegram',
    verifiedField: 'telegramVerifiedAt',
  },
};

export function channelMeta(channel: MessagingChannel): ChannelMeta {
  return META[channel];
}

/** Narrow untrusted input (a route param, a DTO field) to a channel. */
export function parseChannel(value: unknown): MessagingChannel | null {
  const key = String(value ?? '').trim().toLowerCase();

  return (MESSAGING_CHANNELS as readonly string[]).includes(key) ? (key as MessagingChannel) : null;
}
