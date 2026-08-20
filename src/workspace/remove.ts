export type RemoveTerminalAnswer = 'close' | 'keep' | undefined;
export type RemoveTerminalDecision = 'remove-and-close' | 'remove-only' | 'cancel';

/**
 * Tách quyết định UX khỏi VS Code API để mọi nhánh đều test được. Terminal đã đóng không cần
 * hỏi; terminal còn mở bắt buộc phải có lựa chọn rõ ràng trước khi workspace quên nó.
 */
export async function decideTerminalRemoval(
  isOpen: boolean,
  ask: () => Promise<RemoveTerminalAnswer>,
): Promise<RemoveTerminalDecision> {
  if (!isOpen) return 'remove-only';
  const answer = await ask();
  if (answer === 'close') return 'remove-and-close';
  if (answer === 'keep') return 'remove-only';
  return 'cancel';
}
