import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { encryptCredential } from '../common/crypto/credential-crypto';
import { WhatsappPortalService } from './whatsapp-portal.service';

/** What an admin can edit. `apiKey` is write-only — it never comes back out. */
export interface WhatsappSettingsDto {
  enabled: boolean;
  portalUrl: string;
  businessName: string;
  note: string;
  /** New key to store. Blank/omitted = keep the saved one. */
  apiKey?: string;
  /** Explicitly forget the saved key (blank apiKey means "unchanged", not "clear"). */
  clearApiKey?: boolean;
}

/** What the settings page renders. Never includes the key itself. */
export interface WhatsappSettingsView {
  enabled: boolean;
  portalUrl: string;
  businessName: string;
  note: string;
  /** Masked tail of the saved key, e.g. "••••a3f9", or '' when none is saved. */
  apiKeyHint: string;
  /** True once this workspace has its own portal URL + key saved. */
  workspaceConfigured: boolean;
  /** True when WA_PORTAL_* env vars exist as a fallback. */
  envConfigured: boolean;
  /** Whether sending actually works right now, from either source. */
  active: boolean;
  /** Which credentials are live: 'workspace' | 'env' | 'none'. */
  source: 'workspace' | 'env' | 'none';
}

/** Stored under Tenant.settings.whatsapp. The key is encrypted at rest. */
interface StoredWhatsapp {
  enabled: boolean;
  portalUrl: string;
  businessName: string;
  note: string;
  apiKeyEnc?: string;
  apiKeyHint?: string;
}

const DEFAULTS: StoredWhatsapp = { enabled: false, portalUrl: '', businessName: '', note: '' };

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portal: WhatsappPortalService,
  ) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) throw new ForbiddenException('Admins only');
  }

  async getWhatsapp(user: AuthUser): Promise<WhatsappSettingsView> {
    return this.view(user.tenantId, await this.stored(user.tenantId));
  }

  async setWhatsapp(user: AuthUser, dto: Partial<WhatsappSettingsDto>): Promise<WhatsappSettingsView> {
    this.assertAdmin(user);

    const current = await this.stored(user.tenantId);
    const next: StoredWhatsapp = {
      enabled: !!dto.enabled,
      // Store the URL bare — the send path appends /api/v1/..., so a pasted
      // trailing slash or a full endpoint URL would otherwise break every call.
      portalUrl: (dto.portalUrl ?? '').trim().replace(/\/+$/, ''),
      businessName: (dto.businessName ?? '').trim(),
      note: (dto.note ?? '').trim(),
      apiKeyEnc: current.apiKeyEnc,
      apiKeyHint: current.apiKeyHint,
    };

    const key = (dto.apiKey ?? '').trim();
    if (dto.clearApiKey) {
      delete next.apiKeyEnc;
      delete next.apiKeyHint;
    } else if (key) {
      // Encrypted with the same key as mailbox passwords (CREDENTIAL_ENCRYPTION_KEY).
      next.apiKeyEnc = encryptCredential(key);
      next.apiKeyHint = `••••${key.slice(-4)}`;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings as Record<string, unknown>) ?? {};

    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { settings: { ...settings, whatsapp: next } as object },
    });

    return this.view(user.tenantId, next);
  }

  /** Ask the portal whether the saved credentials work and the number is paired. */
  async testWhatsapp(user: AuthUser) {
    this.assertAdmin(user);
    return this.portal.status(user.tenantId);
  }

  // -- internals ----------------------------------------------------------

  private async stored(tenantId: string): Promise<StoredWhatsapp> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const saved = ((tenant?.settings as Record<string, unknown>)?.whatsapp ?? {}) as Partial<StoredWhatsapp>;

    return { ...DEFAULTS, ...saved };
  }

  private async view(tenantId: string, w: StoredWhatsapp): Promise<WhatsappSettingsView> {
    const workspaceConfigured = !!w.portalUrl && !!w.apiKeyEnc;
    const live = await this.portal.configFor(tenantId);

    return {
      enabled: w.enabled,
      portalUrl: w.portalUrl,
      businessName: w.businessName,
      note: w.note,
      apiKeyHint: w.apiKeyHint ?? '',
      workspaceConfigured,
      envConfigured: this.portal.envConfigured,
      active: !!live,
      source: live?.source ?? 'none',
    };
  }
}
