import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { encryptCredential, decryptCredential } from '../common/crypto/credential-crypto';

/** OpenAI's cost-optimized GPT-5.6 model — the default for bulk template drafting. */
const DEFAULT_MODEL = 'gpt-5.6-luna';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PLACEHOLDERS = '{{first_name}}, {{last_name}}, {{company}}, {{country}}, {{email}}';

export interface GenerateBatchDto {
  clientName?: string;
  context: string; // product / industry / audience the emails are about
  tone?: string;
  monthlyCount?: number; // how many "rest of month" variations to draft
  includeInitial?: boolean;
  includeFollowup?: boolean;
  namePrefix?: string; // e.g. "BHAVYA STEEL-RFM-1"
}
export interface RewriteDto {
  subject: string;
  bodyHtml: string;
  note?: string; // optional extra instruction
}
export interface DraftTemplate { kind: string; name: string; subject: string; bodyHtml: string }

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  constructor(private prisma: PrismaService) {}

  // ── settings (super-admin only writes; staff may read the status) ─────────
  async getSettings(user: AuthUser) {
    this.assertStaff(user);
    const t = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { aiApiKey: true, aiModel: true } });
    return { configured: !!t?.aiApiKey, model: t?.aiModel || DEFAULT_MODEL };
  }

  async setSettings(user: AuthUser, dto: { apiKey?: string; model?: string }) {
    if (user.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Only a super admin can set the AI key.');
    const data: { aiApiKey?: string | null; aiModel?: string | null } = {};
    if (dto.apiKey !== undefined) {
      const key = dto.apiKey.trim();
      data.aiApiKey = key ? encryptCredential(key) : null; // empty string clears it
    }
    if (dto.model !== undefined) {
      const m = dto.model.trim();
      data.aiModel = m || null;
    }
    await this.prisma.tenant.update({ where: { id: user.tenantId }, data });
    return this.getSettings(user);
  }

  // ── generation ────────────────────────────────────────────────────────────
  async generateBatch(user: AuthUser, dto: GenerateBatchDto): Promise<{ templates: DraftTemplate[] }> {
    this.assertStaff(user);
    const context = (dto.context || '').trim();
    if (!context) throw new BadRequestException('Describe what the emails are about first.');
    const monthly = Math.min(Math.max(dto.monthlyCount ?? 11, 0), 12);
    const prefix = (dto.namePrefix || 'TEMPLATE').trim();

    const wants: string[] = [];
    if (dto.includeInitial) wants.push('one INITIAL cold-outreach email');
    if (dto.includeFollowup) wants.push('one FOLLOW-UP email (assumes no reply to the initial)');
    if (monthly > 0) wants.push(`${monthly} distinct "monthly touch" emails, each a fresh angle so the same audience is never sent an identical pattern`);
    if (wants.length === 0) throw new BadRequestException('Choose at least one thing to generate.');

    const system =
      'You are an expert B2B cold-email copywriter for export/import (EXIM) outreach. ' +
      'Write concise, natural, deliverability-friendly emails that avoid spam-trigger words and heavy sales language. ' +
      `Always keep these placeholders available and use them where natural: ${PLACEHOLDERS}. ` +
      'Return ONLY valid JSON, no prose.';
    const user_msg =
      `Business/context: ${context}\n` +
      (dto.clientName ? `Client/company: ${dto.clientName}\n` : '') +
      `Tone: ${dto.tone || 'professional, warm, concise'}\n\n` +
      `Generate: ${wants.join('; ')}.\n` +
      `Name each template "${prefix}-<n>" in order (initial first if present, then follow-up, then monthly).\n` +
      'Each email body must be simple HTML (<p>, <br>, <a>) — no <html>/<head>/<style>. Keep subjects short.\n' +
      'Respond as JSON of this exact shape: ' +
      '{"templates":[{"kind":"initial|followup|monthly","name":"...","subject":"...","bodyHtml":"..."}]}';

    const parsed = await this.callOpenAI(user.tenantId, [
      { role: 'system', content: system },
      { role: 'user', content: user_msg },
    ]);
    const templates = this.coerceTemplates(parsed);
    if (templates.length === 0) throw new BadRequestException('The model returned no templates — try again or refine the context.');
    return { templates };
  }

  async rewrite(user: AuthUser, dto: RewriteDto): Promise<DraftTemplate> {
    this.assertStaff(user);
    if (!dto.subject && !dto.bodyHtml) throw new BadRequestException('Nothing to rewrite.');
    const system =
      'You rewrite B2B outreach emails to reduce spam-filter risk while preserving meaning, intent and structure. ' +
      `Keep every placeholder intact (${PLACEHOLDERS}). Soften salesy/spammy wording, avoid trigger words, keep it human. ` +
      'Body stays simple HTML (<p>, <br>, <a>). Return ONLY valid JSON.';
    const user_msg =
      (dto.note ? `Extra instruction: ${dto.note}\n\n` : '') +
      `Original subject: ${dto.subject}\nOriginal bodyHtml: ${dto.bodyHtml}\n\n` +
      'Respond as JSON: {"subject":"...","bodyHtml":"..."}';
    const parsed = await this.callOpenAI(user.tenantId, [
      { role: 'system', content: system },
      { role: 'user', content: user_msg },
    ]);
    const subject = typeof parsed?.subject === 'string' ? parsed.subject : dto.subject;
    const bodyHtml = typeof parsed?.bodyHtml === 'string' ? parsed.bodyHtml : dto.bodyHtml;
    return { kind: 'rewrite', name: '', subject, bodyHtml };
  }

  /** Quick verification that the key + model actually work (a tiny, cheap call).
   *  Tests the typed key/model when provided, else the stored settings. */
  async testKey(user: AuthUser, override?: { apiKey?: string; model?: string }): Promise<{ ok: boolean; model: string }> {
    this.assertStaff(user);
    const { key, model } = await this.resolveKeyModel(user.tenantId, override);
    await this.chat(key, model, [{ role: 'user', content: 'Reply with the single word: ok' }], false);
    return { ok: true, model };
  }

  /** Is a tenant OpenAI key configured? (used by other engines, e.g. LinkedIn). */
  async tenantConfigured(tenantId: string): Promise<boolean> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiApiKey: true } });
    return !!t?.aiApiKey;
  }

  /** Generic JSON generation with the tenant's OpenAI key — shared by other
   *  modules (LinkedIn). Tolerant parse so callers can ask for an array or object. */
  async generateJsonForTenant<T = unknown>(tenantId: string, system: string, user: string): Promise<T> {
    const { key, model } = await this.resolveKeyModel(tenantId);
    const content = await this.chat(key, model, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], false);
    return looseJsonParse(content) as T;
  }

  // ── OpenAI plumbing ─────────────────────────────────────────────────────
  private async resolveKeyModel(tenantId: string, override?: { apiKey?: string; model?: string }): Promise<{ key: string; model: string }> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiApiKey: true, aiModel: true } });
    const model = override?.model?.trim() || t?.aiModel || DEFAULT_MODEL;
    const overrideKey = override?.apiKey?.trim();
    if (overrideKey) return { key: overrideKey, model };
    if (!t?.aiApiKey) throw new BadRequestException('No OpenAI key configured. Ask a super admin to add it in My Account.');
    try { return { key: decryptCredential(t.aiApiKey), model }; }
    catch { throw new BadRequestException('The stored OpenAI key could not be read — please re-enter it.'); }
  }

  private async callOpenAI(tenantId: string, messages: { role: string; content: string }[]): Promise<any> {
    const { key, model } = await this.resolveKeyModel(tenantId);
    const content = await this.chat(key, model, messages, true);
    try { return JSON.parse(content); } catch { throw new BadRequestException('OpenAI returned malformed output — try again.'); }
  }

  private async chat(key: string, model: string, messages: { role: string; content: string }[], jsonMode: boolean): Promise<string> {
    const body: Record<string, unknown> = { model, messages };
    // No custom temperature — some models reject it; the prompt drives variety.
    if (jsonMode) body.response_format = { type: 'json_object' };
    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.warn(`OpenAI request failed: ${err}`);
      throw new BadRequestException('Could not reach OpenAI. Check the server has internet access and try again.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
      if (res.status === 401) throw new BadRequestException('OpenAI rejected the API key (401) — check the key in My Account.');
      if (res.status === 404) throw new BadRequestException(`OpenAI doesn't recognise the model "${model}" (404) — check the model name in My Account.`);
      if (res.status === 429) throw new BadRequestException('OpenAI rate limit / quota reached (429) — try later or check billing.');
      throw new BadRequestException(`OpenAI error (${res.status}). ${extractErr(text)}`);
    }
    const data = await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new BadRequestException('OpenAI returned an empty response — try again.');
    return content;
  }

  private coerceTemplates(parsed: any): DraftTemplate[] {
    const arr: any[] = Array.isArray(parsed?.templates) ? parsed.templates : Array.isArray(parsed) ? parsed : [];
    return arr
      .filter((t) => t && (t.subject || t.bodyHtml))
      .slice(0, 20)
      .map((t, i) => ({
        kind: String(t.kind ?? 'monthly'),
        name: String(t.name ?? `Template-${i + 1}`).slice(0, 120),
        subject: String(t.subject ?? '').slice(0, 300),
        bodyHtml: String(t.bodyHtml ?? '') || '<p></p>',
      }));
  }

  private assertStaff(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('Not available for this role.');
    }
  }
}

function extractErr(text: string): string {
  try { const j = JSON.parse(text); return String(j?.error?.message ?? '').slice(0, 200); } catch { return ''; }
}

/** Parse JSON from a model reply that may be wrapped in ``` fences or prose. */
function looseJsonParse(raw: string): unknown {
  const s = String(raw ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch { /* fall through to substring extraction */ }
  const first = Math.min(...['[', '{'].map((c) => { const i = s.indexOf(c); return i < 0 ? Infinity : i; }));
  const last = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
  if (first !== Infinity && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch { /* ignore */ }
  }
  throw new BadRequestException('The AI returned malformed output — try again.');
}
