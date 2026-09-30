/**
 * 场景工艺块的内容层：块正文、场景触发词表、测试样例。
 * 机制（开关、fail-open 闸、多工程信号 skip、注入位置）在 inject.ts；这里只放文字。
 *
 * 本文件是中性示例：叙事/角色扮演场景的写作工艺下限。联系人可以把 sceneCraft
 * 设为 always（进 session 前缀）、scene（仅场景回合注入，默认）或 off。
 *
 * 块必须保持静态（无时间戳/联系人名），以免破坏 prompt-cache 前缀稳定性。
 */

/** 块标题去掉 `# ` 与收尾括注后的稳定前缀，测试与日志按它定位块。 */
export const SCENE_CRAFT_MARK = '叙事场景书写工艺（网关 compact';

export const SCENE_CRAFT_LINES: readonly string[] = [
  `# ${SCENE_CRAFT_MARK}，场景触发）`,
  '- 触发：用户请求续写故事、角色扮演或场景描写时执行；纯工程与日常事务不套用。',
  '- 感官密度：关键动作单元至少落地一种感官细节与一种可观察反馈；不要求每句机械重复；绝不空泛。',
  '- 具体胜过概括：用可见、可听、可触的细节代替「很好」「很美」这类笼统形容词。',
  '- 动作闭环：意图 → 行动 → 对方反馈 → 读取 → 调整；禁止只罗列动作不响应。',
  '- 双向描写：稳定主视角，关键节点写入双方的反应；避免报告式来回切镜头。',
  '- 节奏有阶段（铺垫→推进→转折→高潮→收束）；篇幅服从当轮，增篇幅须带来新阶段/反馈/情绪，禁同义复述与循环注水。',
  '- 本块是写作下限，不是上限；联系人自己的人设可在其上叠加风格。',
];

/** 块里必须保住的硬约束短语；回归测试逐条断言，改写块时不得丢。 */
export const SCENE_CRAFT_CUES: readonly string[] = [
  '场景触发',
  '感官密度',
  '关键动作单元',
  '动作闭环',
  '双向描写',
  '绝不空泛',
  '禁同义复述与循环注水',
];

/** 场景正向触发词：命中即注入。 */
export const SCENE_RE =
  /续写|故事|小说|剧情|角色扮演|场景描写|描写|旁白|对白|独白|章节|番外|写一段|写一场|roleplay|role-play|storytelling|fanfic/i;

/**
 * 闸门回归样例（smoke-token-round2-gates 撤闸必红）。约束：
 * - hard / short 命中 SCENE_RE，且不含工程信号；
 * - mixedUncertain 命中 SCENE_RE，且至少带一个工程词；
 * - hardSparseEng 命中 SCENE_RE，恰好一个工程信号；
 * - softSparseEng 每条不命中 SCENE_RE、恰好一个工程信号（只能靠 fail-open 注入）。
 */
export const SCENE_SAMPLES = {
  hard: '续写昨天的故事，写一段雨夜的对白',
  short: '续写',
  mixedUncertain: '帮我看下这个 smoke 报错，顺便…把故事续写完',
  hardSparseEng: '续写昨天的故事，写一段雨夜的对白……对了那个 commit 先放一边',
  softSparseEng: [
    '雨还在下，她把伞往他那边偏了偏。那个 deploy 明天再说',
    '灯一盏盏灭下去，街角只剩脚步声，git 什么的先别管',
    '他停在门口没进来，别急着去看那个 commit',
  ] as readonly string[],
} as const;
