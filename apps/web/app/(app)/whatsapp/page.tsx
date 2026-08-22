'use client';

import ChannelSettingsCard from '@/components/ChannelSettingsCard';
import { PageHeader } from '@/components/ui';

/**
 * Messaging settings: one card per network.
 *
 * Both go through the same self-hosted portal, one project each, so they are
 * set up the same way and only the API key says which network a message leaves
 * by. A workspace can run either, both, or neither.
 */
export default function MessagingSettingsPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Messaging notifications"
        subtitle="Connect this workspace to the portal so alerts and number verification can send on WhatsApp, Telegram, or both."
      />

      <div className="grid gap-4">
        <ChannelSettingsCard channel="whatsapp" />
        <ChannelSettingsCard channel="telegram" />
      </div>

      <p className="mt-4 text-xs text-slate-400">
        The portal holds one account per project and queues sending, so alerts never block the action that triggered
        them. People who have verified their number on both networks receive one message on each — set preferences under
        My Account.
      </p>
    </div>
  );
}
