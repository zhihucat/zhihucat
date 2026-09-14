'use client';

import { useMemo, useState } from 'react';
import type { Locale } from '../lib/localization';

type GuidePhase = 'investigate' | 'court' | 'ending';
type GuideTopic = 'story' | 'mission' | 'boundary';

const OVERVIEW_COPY = {
  zh: {
    name: '刘看山 · 故事向导', status: '只讲证据，不讲结局', title: '先用一分钟看懂《蓝血》',
    intro: '嗨，我是刘看山。我会把公开片段写明的事实和我们的推断分开，帮你带着完整背景进入调查。',
    topics: [
      ['story', '故事发生了什么'], ['mission', '我在游戏里做什么'], ['boundary', '哪些还不能确定'],
    ] as Array<[GuideTopic, string]>,
    answers: {
      story: '方诺在急救培训中听到一个所有人都认可的常识：人的血原本是蓝色，接触空气后才会变红。可她亲眼看见自己的血从一开始就是红色，同事的血却真的会由蓝变红。随后，异常从身体延伸到公共记录、只针对她的测试和可疑的跟随者。公开片段停在她准备向问答社区求证的位置。',
      mission: '你要走完三个场景，找齐六条线索；再用“方诺红血、同事蓝转红、定向试卷”三张关键锚点，加上一张代表推理方向的证据进入质证。最后选择当前最值得验证的假说和一条知乎求证问题。',
      boundary: '目前只能确认方诺的经验与周围共同认知持续冲突。世界置换、记忆错位或有人观察她，都只是竞争假说。游戏不会替作者续写，也不会把阶段推演当成原作答案。',
    },
    start: '明白了，开始搜证 →',
  },
  en: {
    name: 'Liu Kanshan · Story Guide', status: 'Evidence first · no invented ending', title: 'Understand Blue Blood in one minute',
    intro: 'Hi, I am Liu Kanshan. I separate facts stated in the public excerpt from our inferences, so you enter the investigation with the full context.',
    topics: [
      ['story', 'What happened'], ['mission', 'What do I do'], ['boundary', 'What remains unknown'],
    ] as Array<[GuideTopic, string]>,
    answers: {
      story: 'At a first-aid workshop, Fang Nuo hears a fact everyone accepts: blood is blue until air turns it red. Her own blood is red immediately, while a colleague’s really changes from blue to red. The conflict then spreads to public records, a test written only for her, and a possible follower. The public excerpt stops just before she asks an online community for help.',
      mission: 'Explore all three scenes and find six clues. Bring the three anchors—Fang Nuo’s red blood, her colleague’s color-changing blood, and the targeted test—plus one hypothesis card into the challenge. Then choose the most testable explanation and a Zhihu question.',
      boundary: 'The excerpt only establishes a sustained conflict between Fang Nuo’s experience and shared reality. A shifted world, displaced perception, and active observation remain competing hypotheses. The game does not continue the author’s plot or reveal an original ending.',
    },
    start: 'Got it, start investigating →',
  },
} as const;

function Character({ motion, alt }: { motion: string; alt: string }) {
  return <span className="kanshan-character" aria-hidden="true">
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet="/assets/kanshan/still.png" />
      <img src={`/assets/kanshan/${motion}.gif`} alt="" loading="lazy" />
    </picture>
    <span className="sr-only">{alt}</span>
  </span>;
}

export function KanshanStoryGuide({ locale, onStart }: { locale: Locale; onStart: () => void }) {
  const copy = OVERVIEW_COPY[locale];
  const [topic, setTopic] = useState<GuideTopic>('story');
  return <section id="kanshan-overview" className="kanshan-overview" aria-labelledby="kanshan-overview-title">
    <div className="kanshan-overview-character"><Character motion={topic === 'story' ? 'greeting' : 'researching'} alt={copy.name} /></div>
    <div className="kanshan-overview-copy">
      <div className="kanshan-guide-heading"><div><span>{copy.name}</span><small>{copy.status}</small></div><i aria-hidden="true">ZHIHU GUIDE</i></div>
      <h2 id="kanshan-overview-title">{copy.title}</h2>
      <p className="kanshan-intro">{copy.intro}</p>
      <div className="kanshan-topic-tabs" role="tablist" aria-label={locale === 'en' ? 'Story guide topics' : '故事导览主题'}>
        {copy.topics.map(([id, label]) => <button type="button" role="tab" id={`kanshan-tab-${id}`} aria-controls="kanshan-overview-answer" aria-selected={topic === id} className={topic === id ? 'active' : ''} key={id} onClick={() => setTopic(id)}>{label}</button>)}
      </div>
      <p id="kanshan-overview-answer" className="kanshan-answer" role="tabpanel" aria-labelledby={`kanshan-tab-${topic}`} aria-live="polite">{copy.answers[topic]}</p>
      <button type="button" className="button primary kanshan-start" onClick={onStart}>{copy.start}</button>
    </div>
  </section>;
}

type KanshanGuideDockProps = {
  locale: Locale;
  phase: GuidePhase;
  sceneId?: string;
  discoveredCount?: number;
  selectedCount?: number;
  battleResult?: 'player_win' | 'opponent_win' | null;
  sourceMode?: string;
};

export function KanshanGuideDock({ locale, phase, sceneId = '', discoveredCount = 0, selectedCount = 0, battleResult = null, sourceMode }: KanshanGuideDockProps) {
  const [open, setOpen] = useState(false);
  const [answerIndex, setAnswerIndex] = useState(-1);
  const content = useMemo(() => {
    if (locale === 'en') {
      if (phase === 'court') return {
        title: battleResult === 'player_win' ? 'The chain held' : battleResult === 'opponent_win' ? 'This attempt fell short' : 'Challenge the ordinary explanation',
        lead: battleResult === 'player_win' ? 'You presented a complete four-card chain. Move on to a provisional inference.' : battleResult === 'opponent_win' ? 'This does not make your hypothesis wrong. Rebuild the order and protect your argument.' : 'The opponent represents fatigue, faulty memory, and coincidence—not a villain.',
        prompts: ['What is being challenged?', 'How do I build a chain?', 'Does repeating a card help?'],
        answers: [
          'Show that independent observations cannot all be explained by one memory lapse or coincidence.',
          'Connect different sources: because A establishes one conflict and B establishes another, the ordinary explanation no longer covers both.',
          'No. Story mode requires every selected exhibit to be presented at least once.',
        ], motion: battleResult === 'player_win' ? 'celebrate' : 'researching',
      };
      if (phase === 'ending') return {
        title: 'Choose what to test next',
        lead: 'This is an explanation ranking, not the original answer. “Insufficient evidence” is a valid conclusion.',
        prompts: ['Why the suggested hypothesis?', 'Why can others still work?', 'Which question is safest?'],
        answers: [
          'The suggestion follows the direction card in your deck. It describes fit, not certainty.',
          'The same fact can support several explanations. A sound conclusion also states what evidence could disprove it.',
          'The low-risk probe reveals least; the cross-check usually balances information value and exposure better.',
        ], motion: 'thinking',
      };
      const sceneHint = sceneId.endsWith('office')
        ? 'Compare shared teaching, Fang Nuo’s body, and a colleague’s body as separate observations.'
        : sceneId.endsWith('archive')
          ? 'Look for one public record and one arrangement aimed only at Fang Nuo.'
          : 'Separate the feeling of being followed from the behavior she actually observed.';
      return {
        title: `Investigation ${discoveredCount}/6`, lead: sourceMode === 'curated-fallback' ? 'The API is offline, so every item here is labeled as a curated note.' : sceneHint,
        prompts: ['Fact or inference?', 'What makes evidence strong?', 'How do I choose the fourth card?'],
        answers: [
          'A fact states what the excerpt shows. An inference explains why it may have happened. Keep those two layers separate.',
          'Independent sources and observations are stronger than repeating the same claim.',
          `Use all three key anchors. Your fourth card should point toward public-record conflict or active observation. You have selected ${selectedCount}/4.`,
        ], motion: 'thinking',
      };
    }
    if (phase === 'court') return {
      title: battleResult === 'player_win' ? '证据链成立' : battleResult === 'opponent_win' ? '本轮论证未闭合' : '正在反驳日常解释',
      lead: battleResult === 'player_win' ? '四张证据已经全部实际出示，可以进入阶段推演。' : battleResult === 'opponent_win' ? '这不代表假说错误，只表示本轮没有把材料关系讲完整。' : '对面代表疲劳、误记和巧合，不是故事里的反派。',
      prompts: ['反方在质疑什么？', '怎样形成证据链？', '重复出牌有用吗？'],
      answers: [
        '它在问这些材料是否来自独立观察，以及几件异常之间真的有关联，还是恰好同时发生。',
        '用一句话连接不同来源：“因为 A 说明……，而 B 又说明……，所以只用日常解释已经不足以覆盖两者。”',
        '没有。故事模式要求四张入选证据都至少实际展示一次。',
      ], motion: battleResult === 'player_win' ? 'celebrate' : 'researching',
    };
    if (phase === 'ending') return {
      title: '选择下一步要验证什么',
      lead: '这里选择的是当前解释力，不是原作正确答案。“证据不足”也属于合格判断。',
      prompts: ['为什么推荐这个？', '其他假说为何还成立？', '哪种提问更安全？'],
      answers: [
        '推荐项来自你选择的第四张方向牌，只说明它更贴合这副牌，不表示故事已经确认该假说。',
        '同一个事实可以支持多种解释。好的阶段结论还要说明什么证据出现时，它会被推翻。',
        '低风险试探暴露最少；交叉验证通常更能兼顾信息价值和隐蔽性。',
      ], motion: 'thinking',
    };
    const sceneHint = sceneId.endsWith('office')
      ? '比较“教材怎么说、方诺身上发生什么、同事身上发生什么”，这三者是独立观察。'
      : sceneId.endsWith('archive')
        ? '这里要找两类材料：所有人都能看到的公共记录，以及只落在方诺身上的特殊安排。'
        : '把“觉得被跟踪”和“实际看到的行为”分开，后者才可能进入证据链。';
    return {
      title: `搜证进度 ${discoveredCount}/6`, lead: sourceMode === 'curated-fallback' ? '当前是离线案卷，所有内容只称“策划转述”，不冒充已核验原文。' : sceneHint,
      prompts: ['这是事实还是推断？', '什么样的证据更强？', '第四张牌怎么选？'],
      answers: [
        '事实是片段直接写出的观察；推断是对原因的解释。先把事实钉牢，再比较假说。',
        '来自不同对象、不同场景或不同记录的观察，通常比重复同一句话更能排除误记和玩笑。',
        `三张关键锚点必须保留。第四张选城市资料，偏向世界规则置换；选灰夹克，偏向主动观察。当前已选 ${selectedCount}/4 张。`,
      ], motion: 'thinking',
    };
  }, [battleResult, discoveredCount, locale, phase, sceneId, selectedCount, sourceMode]);

  return <aside className={`kanshan-dock ${open ? 'open' : ''}`} aria-label={locale === 'en' ? 'Liu Kanshan story guide' : '刘看山故事向导'}>
    {open && <div className="kanshan-dock-panel">
      <button type="button" className="kanshan-close" onClick={() => setOpen(false)} aria-label={locale === 'en' ? 'Close guide' : '收起故事向导'}>×</button>
      <div className="kanshan-dock-head"><Character motion={content.motion} alt={locale === 'en' ? 'Liu Kanshan' : '刘看山'} /><div><span>{locale === 'en' ? 'Liu Kanshan · Story Guide' : '刘看山 · 故事向导'}</span><strong>{content.title}</strong></div></div>
      <p>{answerIndex < 0 ? content.lead : content.answers[answerIndex]}</p>
      <div className="kanshan-dock-prompts">{content.prompts.map((prompt, index) => <button type="button" key={prompt} className={answerIndex === index ? 'active' : ''} onClick={() => setAnswerIndex(index)}>{prompt}</button>)}</div>
      <small>{locale === 'en' ? 'Public-excerpt guidance only · no invented ending' : '只依据公开片段提示 · 不续写原作结局'}</small>
    </div>}
    <button type="button" className="kanshan-dock-trigger" onClick={() => { setOpen((value) => !value); setAnswerIndex(-1); }} aria-expanded={open} aria-label={locale === 'en' ? `${open ? 'Close' : 'Open'} Liu Kanshan story guide` : `${open ? '收起' : '打开'}刘看山故事向导`}>
      <Character motion={open ? 'idle' : phase === 'ending' ? 'celebrate' : 'greeting'} alt={locale === 'en' ? 'Liu Kanshan' : '刘看山'} />
      <span>{locale === 'en' ? 'Ask Kanshan' : '问看山'}</span>
    </button>
  </aside>;
}
