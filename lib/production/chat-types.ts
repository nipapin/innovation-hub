/**
 * Типы чата этапа для клиента. Отдельно от lib/production/chat.ts: тот тянет
 * базу и push, и в клиентский бандл ему нельзя.
 */
export type { ChatAttachment, ChatMember, ChatMessage, ChatReviewRef } from "./chat"
