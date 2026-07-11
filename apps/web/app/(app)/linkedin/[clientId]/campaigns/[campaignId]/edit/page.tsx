'use client';

import { useParams, useRouter } from 'next/navigation';
import { LiRegularWizard } from '@/components/LiRegularWizard';

export default function EditLiCampaignPage() {
  const { clientId, campaignId } = useParams<{ clientId: string; campaignId: string }>();
  const router = useRouter();
  const back = () => router.push(`/linkedin/${clientId}/campaigns/${campaignId}`);
  return (
    <LiRegularWizard
      clientId={clientId}
      base="/linkedin"
      launchMode="resume"
      editCampaignId={campaignId}
      onBack={back}
      onDone={back}
    />
  );
}
