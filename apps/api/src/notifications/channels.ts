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
export type MessagingChannel = 'whatsapp' | 'telegram' | 'netvork';

export const MESSAGING_CHANNELS: readonly MessagingChannel[] = ['whatsapp', 'telegram', 'netvork'] as const;

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
  notifyField: 'notifyWhatsapp' | 'notifyTelegram' | 'notifyNetvork';
  /** When the user last proved this address reaches them on this network. */
  verifiedField: 'whatsappVerifiedAt' | 'telegramVerifiedAt' | 'netvorkVerifiedAt';
  /**
   * How a message gets there. The two phone networks go through our portal,
   * which speaks one API for both. Netvork is our own app and has no portal —
   * it is reached as an ordinary user of it, holding an account token.
   */
  transport: 'portal' | 'netvork';
  /** Which column on the user holds their address on this network. */
  addressField: 'contactMobile' | 'netvorkAppId';
  /** What that address is called in anything a user reads. */
  addressLabel: string;
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
    transport: 'portal',
    addressField: 'contactMobile',
    addressLabel: 'mobile number',
  },
  telegram: {
    key: 'telegram',
    label: 'Telegram',
    settingsKey: 'telegram',
    envUrl: 'TG_PORTAL_URL',
    envApiKey: 'TG_PORTAL_API_KEY',
    notifyField: 'notifyTelegram',
    verifiedField: 'telegramVerifiedAt',
    transport: 'portal',
    addressField: 'contactMobile',
    addressLabel: 'mobile number',
  },
  /*
   * Netvork is the odd one out, and deliberately so.
   *
   * There is no portal and no phone number: the message is sent as an ordinary
   * direct message from a Netvork account we hold, addressed by App ID. The
   * recipient gets it in their chat, on their notification bell, and as a push
   * to their phone — Netvork's own delivery, which is better than anything a
   * bridge to somebody else's network can promise.
   *
   * The credentials still have the same shape as a portal's, so the settings
   * card, the OTP flow and the tenant storage are all unchanged: the URL is
   * the Netvork install, and the "API key" is that account's bearer token.
   */
  netvork: {
    key: 'netvork',
    label: 'Netvork',
    settingsKey: 'netvork',
    envUrl: 'NETVORK_URL',
    envApiKey: 'NETVORK_API_TOKEN',
    notifyField: 'notifyNetvork',
    verifiedField: 'netvorkVerifiedAt',
    transport: 'netvork',
    addressField: 'netvorkAppId',
    addressLabel: 'Netvork App ID',
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
