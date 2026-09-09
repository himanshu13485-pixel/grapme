import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Find or create a lead's conversation, and record the provider chat id if it is
 * free to take.
 *
 * The row is keyed by leadId, but `unipileChatId` carries its own global unique
 * constraint. So when one LinkedIn chat turns up under two leads — the same
 * person sitting in two campaigns, or re-imported — writing the chat id fails
 * with P2002.
 *
 * That used to throw out of a send that had ALREADY left: the message was never
 * recorded, the lead never moved to MESSAGED, the scheduled action never
 * completed, and BullMQ replayed the job twice more (attempts: 3) — DMing a real
 * person the same follow-up three times.
 *
 * The conversation is what the caller actually needs, so the chat id is written
 * separately and a collision is logged and dropped rather than thrown. Reply
 * matching already falls back to the member id when a conversation has no chat
 * id, so the lead degrades to "sync finds it by member" instead of breaking.
 */
export async function linkConversation(
  prisma: PrismaService,
  leadId: string,
  chatId: string | null | undefined,
  onConflict?: (message: string) => void,
) {
  const conversation = await prisma.liConversation.upsert({
    where: { leadId },
    create: { leadId },
    update: {},
  });
  if (!chatId || conversation.unipileChatId === chatId) return conversation;

  try {
    return await prisma.liConversation.update({
      where: { id: conversation.id },
      data: { unipileChatId: chatId },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      onConflict?.(
        `LinkedIn chat ${chatId} is already linked to another lead — left unset on lead ${leadId}. ` +
          'Usually means the same person exists as two leads.',
      );
      return conversation;
    }
    throw err;
  }
}
