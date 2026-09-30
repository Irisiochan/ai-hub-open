export type WechatTargetId = 'claude' | 'codex' | 'scout';

export interface WechatStickyTarget {
  targetId: WechatTargetId;
  touchedAt: number;
}

export interface WechatRoute {
  targetId: WechatTargetId;
  text: string;
  explicit: boolean;
}

const TARGET_BY_ALIAS: Record<string, WechatTargetId> = {
  'Claude': 'claude',
  codex: 'codex',
  'Scout': 'scout',
};

const EXPLICIT_TARGET = /^\/?(Claude|codex|Scout)(?=$|[\s:：,，])(?:[\s:：,，]+)?/i;

export function routeWechatInput(
  rawText: string,
  sticky: WechatStickyTarget | null,
  now = Date.now(),
  stickyMs = 30 * 60_000,
): WechatRoute | null {
  const text = rawText.trim();
  const match = text.match(EXPLICIT_TARGET);
  if (match) {
    return {
      targetId: TARGET_BY_ALIAS[match[1].toLowerCase()] ?? TARGET_BY_ALIAS[match[1]],
      text: text.slice(match[0].length).trim(),
      explicit: true,
    };
  }
  if (sticky && now - sticky.touchedAt <= stickyMs) {
    return { targetId: sticky.targetId, text, explicit: false };
  }
  return null;
}
