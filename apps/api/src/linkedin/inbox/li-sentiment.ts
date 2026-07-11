import { LiSentiment } from '@prisma/client';

const POSITIVE = /\b(yes|interested|sure|sounds good|let'?s|happy to|book|schedule|call|demo|keen|great|perfect|absolutely)\b/i;
const NEGATIVE = /\b(no|not interested|stop|unsubscribe|remove|don'?t|leave me|spam|never|unfortunately)\b/i;

/** Cheap, free heuristic sentiment applied on reply ingest (AI Fetch does the real thing). */
export function quickSentiment(text: string): LiSentiment {
  if (NEGATIVE.test(text)) return LiSentiment.NEGATIVE;
  if (POSITIVE.test(text)) return LiSentiment.POSITIVE;
  return LiSentiment.NEUTRAL;
}
