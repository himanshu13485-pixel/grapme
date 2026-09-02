'use client';

import ChannelSettingsCard from '@/components/ChannelSettingsCard';
import { PageHeader } from '@/components/ui';

/**
 * Messaging settings: one card per network.
 *
 * WhatsApp and Telegram go through the same self-hosted portal, one project
 * each, so they are set up the same way and only the API key says which
 * network a message leaves by. Netvork is set up the same way from here but
 * is not a portal at all — it is our own app, and the credentials are an
 * account on it. A workspace can run any of them, all, or none.
 */
export default function MessagingSettingsPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Messaging notifications"
        subtitle="Connect this workspace so alerts and verification codes can send on WhatsApp, Telegram, Netvork, or any combination."
      />

      <div className="grid gap-4">
        <ChannelSettingsCard channel="whatsapp" />
        <ChannelSettingsCard channel="telegram" />
        <ChannelSettingsCard channel="netvork" />
      </div>

      <p className="mt-4 text-xs text-slate-400">
        The portal holds one account per project and queues sending, so alerts never block the action that triggered
        them; Netvork queues on its own side for the same reason. Someone verified on more than one network receives one
        message on each — people set their own preferences under My Account.
        <br />
        Netvork differs in one way worth knowing before you switch it on: it only delivers to people connected to the
        sending account, so each person has to accept a connection request from it once. In exchange the alert arrives
        in their Netvork chat, on their notification bell, and as a push to their phone.
      </p>
    </div>
  );
}
