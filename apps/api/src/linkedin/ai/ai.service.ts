import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Provider-agnostic AI wrapper (Anthropic). Lazy — callers fall back when not configured. */
@Injectable()
export class LiAiService {
  private readonly logger = new Logger(LiAiService.name);
  private client: any;

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return !!this.config.get<string>('ANTHROPIC_API_KEY');
  }

  private getClient() {
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require('@anthropic-ai/sdk');
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async generateJson<T>(system: string, user: string): Promise<T> {
    const client = this.getClient();
    const model = this.config.get<string>('AI_MODEL') ?? 'claude-sonnet-5';
    const res = await client.messages.create({
      model, max_tokens: 2500, system, messages: [{ role: 'user', content: user }],
    });
    const text: string = (res.content ?? []).map((c: any) => c.text ?? '').join('');
    return this.parseJson<T>(text);
  }

  private parseJson<T>(text: string): T {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw new Error('AI response did not contain JSON');
    return JSON.parse(match[0]) as T;
  }
}
