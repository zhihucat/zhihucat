const { ZHIHU_HACKATHON_API_BASE, validateWorkId } = require('./zhihu-content');

const FEATURED_STORY_ID = '2025684191967294692';
const FEATURED_STORY_ORIGINAL_URL = 'https://www.zhihu.com/market/paid_column/2025901212759783232/section/2025684191967294692';
const STORY_CASE_PREFIX = 'zhihu-story-';

const featuredFallback = {
  work_id: FEATURED_STORY_ID,
  title: '蓝血',
  chapter_name: '蓝血',
  author_name: '桃花先生',
  artwork: 'https://pic1.zhimg.com/v2-3e56c7f56db0549c5221ce9d8622e982.jpg?source=33ed3ac9',
  tab_artwork: 'https://picx.zhimg.com/v2-fccd003948c47e2f94ed6c5421a21574.jpg?source=33ed3ac9',
  description: '我发现这个世界不对劲，这里的人说，血是蓝的。',
  introduction: '我发现这个世界不对劲，这里的人说，血是蓝的。',
  labels: ['悬疑', '惊悚', '脑洞', '反转', '烧脑', '现代'],
  content: '',
  content_length: 0,
};

function storyApiUrl(workId) {
  return `${ZHIHU_HACKATHON_API_BASE}/story/${encodeURIComponent(workId)}`;
}

function safeZhihuImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || (!url.hostname.endsWith('.zhimg.com') && !url.hostname.endsWith('.zhihu.com'))) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function decorateSummary(item) {
  const workId = String(item.work_id);
  return {
    workId,
    caseId: `${STORY_CASE_PREFIX}${workId}`,
    title: item.title,
    artwork: safeZhihuImageUrl(item.artwork || item.tab_artwork),
    description: item.description || '',
    labels: Array.isArray(item.labels) ? item.labels : [],
    playable: workId === FEATURED_STORY_ID,
  };
}

async function listStoryChoices(client) {
  try {
    const stories = await client.listStories();
    const decorated = stories.map(decorateSummary);
    if (!decorated.some((story) => story.playable)) throw new Error('知乎故事目录中暂无《蓝血》');
    decorated.sort((left, right) => Number(right.playable) - Number(left.playable));
    return { stories: decorated, source: 'zhihu-live', featuredWorkId: FEATURED_STORY_ID };
  } catch (error) {
    return {
      stories: [decorateSummary(featuredFallback)],
      source: 'curated-fallback',
      featuredWorkId: FEATURED_STORY_ID,
      warning: error.message,
    };
  }
}

function makeEvidence(workId, key, title, description, purpose, sourceRange, type = 'document', credibility = 9, quote = '') {
  return {
    id: `${STORY_CASE_PREFIX}${workId}-ev-${key}`,
    title,
    type,
    sourceDocumentId: `${STORY_CASE_PREFIX}${workId}-doc-${key}`,
    sourceRange,
    description,
    proofPurpose: purpose,
    quote,
    credibility,
    authenticity: '知乎故事公开片段 · 策划整理',
    relevance: '高',
  };
}

function buildBlueBloodCase(story, mode = 'zhihu-live') {
  const workId = FEATURED_STORY_ID;
  const title = story.chapter_name || story.title || featuredFallback.title;
  const author = story.author_name || featuredFallback.author_name;
  const introduction = story.introduction || story.description || featuredFallback.introduction;
  const caseSummary = '方诺发现，周围的人都把“人的血液原本是蓝色，接触空气后才会变红”当作常识；可她刺破手指时，看到的血从一开始就是红色。很快，不一致从身体蔓延到公共记录和周围人的行为。她必须在被察觉之前，判断究竟是谁的世界出了错。';
  const labels = Array.isArray(story.labels) && story.labels.length ? story.labels : featuredFallback.labels;
  const artwork = safeZhihuImageUrl(story.artwork || story.tab_artwork) || featuredFallback.artwork;
  const content = typeof story.content === 'string' ? story.content.replace(/\r\n/g, '\n') : '';
  const quoteIfPresent = (quote) => content.includes(quote) ? quote : '';
  const evidence = [
    makeEvidence(workId, 'manual', '培训教材的蓝血常识', '培训师、教材和所有同事都坚持人的血液原本呈蓝色。', '证明“蓝血”在这个世界被当作公开且一致的常识。', '开篇 · 公司急救培训', 'document', 9, quoteIfPresent('人的血液是蓝色的，接触空气后才会慢慢氧化变红。')),
    makeEvidence(workId, 'finger', '指尖流出的红血', '方诺独自在洗手间刺破手指，看到自己的血从一开始就是红色。', '证明方诺自身的生理现象与周围常识存在直接冲突。', '开篇 · 洗手间自检', 'image', 8, quoteIfPresent('鲜红色的血涌上来，我总算长舒一口气。')),
    makeEvidence(workId, 'gum', '同事由蓝变红的血迹', '同事牙龈出血时，血液先呈蓝色，接触空气后才逐渐变红。', '排除集体玩笑，说明同事的生理现象确实符合蓝血规则。', '第01节 · 洗手间门缝观察', 'image', 9, quoteIfPresent('白色的牙齿上，蓝色的血正在慢慢变红。')),
    makeEvidence(workId, 'archive', '与记忆冲突的城市资料', '网络资料把东方明珠、陆家嘴和黄浦江记录成与方诺记忆完全不同的信息。', '支持异常不只涉及血液知识，也可能覆盖公共记录和地理事实。', '第01节 · 深夜网络检索', 'document', 8, quoteIfPresent('东方明珠塔的简介上写着：位于北京朝阳区的标志性建筑')),
    makeEvidence(workId, 'exam', '只针对方诺的测试卷', '其他同事拿到普通急救题，方诺的试卷却专门询问血液、头发等基础常识。', '强烈支持培训方在识别她是否察觉世界异常，但单独不能证明其动机。', '第02节 · 定向测试', 'document', 9, quoteIfPresent('同事的试卷，里面都是关于急救的知识。\n而我的，第一题是：人的血液是什么颜色？')),
    makeEvidence(workId, 'follower', '没有折返的灰夹克', '灰夹克男子多次出现并疑似尾随；他走进没有出口的老巷后，方诺等了很久也没见他折返。', '支持“被监视”或“存在异常通道”的假说，但也保留误认、藏身等日常解释。', '第03节 · 老街跟踪', 'image', 7, quoteIfPresent('但灰夹克从我面前走过后，我等了很久，他却始终没有回来。')),
  ];
  const verifiedQuoteCount = evidence.filter((item) => item.quote).length;

  const documents = evidence.map((item) => ({
    id: item.sourceDocumentId,
    name: item.title,
    type: item.type,
    content: item.quote
      ? `【知乎公开片段 · 原文短引】\n故事：《${title}》\n作者：${author}\n位置：${item.sourceRange}\n\n“${item.quote}”\n\n策划释义：${item.description}\n\n短引由本次接口响应即时核验；完整正文不在本项目中保存。`
      : `【策划线索转述 · 非原文全文】\n故事：《${title}》\n作者：${author}\n位置：${item.sourceRange}\n\n${item.description}\n\n官方接口当前不可用或原文锚点未命中；最终故事走向以知乎内容为准。`,
    hotspots: [{ id: `${item.id}-pointer`, evidenceId: item.id, label: item.proofPurpose }],
  }));

  return {
    id: `${STORY_CASE_PREFIX}${workId}`,
    levelId: 91,
    levelTitle: '蓝血疑云',
    desc: '知乎故事互动案卷',
    title: `蓝血疑云 · 谁的世界出了错？`,
    type: '知乎故事 · 悬疑推理',
    difficulty: 3,
    playerSide: '异常解释 · 世界规则发生变化',
    opponentSide: '日常解释 · 疲劳 / 误记 / 巧合',
    goal: '在公开片段范围内，判断“客观异常”是否比疲劳、误记或巧合更能解释全部线索，并指出仍不能确定的部分。',
    summary: caseSummary,
    focus: ['红血与蓝血能否同时为真', '定向测试是否说明有人在筛查异类', '公共记录与跟踪者能否形成同一条异常链'],
    actionPoints: 6,
    scenes: [
      {
        id: `${STORY_CASE_PREFIX}${workId}-scene-office`, title: '场景一 · 急救培训室',
        description: '教材、同事和方诺的身体给出了互相冲突的答案。',
        hotspots: evidence.slice(0, 3).map((item) => ({ id: `${item.id}-spot`, evidenceId: item.id, title: item.title, icon: '🩸', hint: item.description })),
      },
      {
        id: `${STORY_CASE_PREFIX}${workId}-scene-archive`, title: '场景二 · 深夜资料库',
        description: '血液之外，公共世界的地理资料也与方诺的记忆错位。',
        hotspots: evidence.slice(3, 5).map((item) => ({ id: `${item.id}-spot`, evidenceId: item.id, title: item.title, icon: '🗂️', hint: item.description })),
      },
      {
        id: `${STORY_CASE_PREFIX}${workId}-scene-alley`, title: '场景三 · 老街死胡同',
        description: '被监视的感觉第一次转化为可观察的行动线索。',
        hotspots: evidence.slice(5).map((item) => ({ id: `${item.id}-spot`, evidenceId: item.id, title: item.title, icon: '🕵️', hint: item.description })),
      },
    ],
    documents,
    evidence,
    // Three required anchors leave the fourth court slot for an actual player choice:
    // public-record mismatch or the weaker, more speculative follower clue.
    keyEvidenceIds: [evidence[1].id, evidence[2].id, evidence[4].id],
    hypothesisEvidenceIds: [evidence[3].id, evidence[5].id],
    keywords: [
      ['红血', '蓝血', '同事', '观察', '生理'],
      ['测试', '试卷', '筛查', '培训师', '常识'],
      ['资料', '地标', '跟踪', '死胡同', '异常'],
    ],
    adversary: [
      '个人记忆也可能出错。请说明为什么两种血液现象比“方诺太疲劳”更能解释现场。',
      '公司进行培训考试并不罕见。请指出这张试卷为何是针对方诺的筛查。',
      '网络资料错误和陌生人同行都可能只是巧合。请把它们与前面的异常串成可检验的时间线。',
    ],
    storyEnding: {
      title: '案卷暂时封存',
      description: '以下选项只比较知乎公开片段内不同解释的强弱，并帮助方诺选择下一步验证方式；所有结果均为阶段推演，不代表原作结局，也不会续写原作。',
      hypotheses: [
        {
          id: 'world-shift',
          title: '世界规则发生置换',
          description: '方诺进入或醒在了一个规则不同的现实；她保留了原来的记忆和生理特征。',
          support: '方诺的血从一开始就是红色，同事的血却先蓝后红；公共地理资料也与她的稳定记忆发生冲突。',
          evidenceGap: '公开片段没有提供置换发生的时间、机制或其他独立经历者，记忆或感知错位仍未被排除。',
          nextStep: '寻找不依赖当前网络资料的旧物、离线记录或独立记忆者。',
        },
        {
          id: 'perception-memory-shift',
          title: '感知或记忆发生系统性错位',
          description: '周围世界可能保持一致，发生偏移的是方诺对常识、地点或现场的感知与记忆。',
          support: '教材、同事和公共资料彼此一致，目前明确持有不同记忆的人只有方诺。',
          evidenceGap: '方诺不仅回忆不同，还观察到了自己与同事不同的血液现象；定制试卷也难以仅用个人误记完整解释。',
          nextStep: '让不知情的第三方分别记录地标记忆和血液观察，再比较结果。',
        },
        {
          id: 'controlled-observation',
          title: '有人在进行现实操控或观察实验',
          description: '某个未知主体可能知道方诺察觉了异常，并通过测试和跟随确认她掌握了多少信息。',
          support: '方诺拿到与同事不同的常识试卷；灰夹克男子反复出现，并在进入死胡同后长时间没有折返。',
          evidenceGap: '定制试卷可能是普通抽题差异，灰夹克也可能只是误认或暂时藏身；两者之间尚无直接因果证据。',
          nextStep: '记录测试题差异和灰夹克出现时间，验证两者是否持续相关。',
        },
        {
          id: 'insufficient-evidence',
          title: '证据不足，暂不站队',
          description: '三种解释都能解释部分事实，但没有一种覆盖全部线索。',
          support: '当前最可靠的结论只是：方诺的个人经验与周围共同认知存在持续冲突。',
          evidenceGap: '血液现象、城市记忆、定向测试与灰夹克之间尚未形成能够排除其他解释的完整因果链。',
          nextStep: '优先验证血液现象与城市记忆，再决定是否需要测试“世界置换”或“主动观察”。',
        },
      ],
      questions: [
        {
          id: 'direct-disclosure',
          title: '直接曝光',
          question: '为什么我的血从流出时就是红色，而周围人都说血液接触空气前是蓝色？',
          explanation: '这条问题把最核心的异常完整公开，容易获得医学解释、类似经历和直接质疑，也可能最快发现回答者之间是否存在认知差异。',
          informationValue: '高：直接检验“蓝血是否为共同常识”，并可能获得独立观察案例。',
          risk: '高：血液差异非常具体。如果确实有人在筛查方诺，这条问题可能暴露她已经察觉异常。',
          limitation: '回答者可能复述公开资料，无法证明他们亲眼观察过血液现象。',
          recommended: false,
        },
        {
          id: 'cross-check',
          title: '交叉验证',
          question: '做一个不搜索的记忆小调查：你第一反应里，东方明珠位于哪座城市？你最早从哪里知道这个答案？',
          explanation: '这条问题不提血液，也不直接宣称世界异常，却能收集独立记忆及其来源，检验“公共资料一致”和“个人记忆一致”是否是一回事。',
          informationValue: '高：能够比较回答内容、记忆来源和形成时间，比简单投票更有验证价值。',
          risk: '中：问题略显反常，但不会直接暴露方诺最独特的生理差异。',
          limitation: '回答者仍可能先搜索再作答，因此必须明确要求“不搜索、只写第一反应”。',
          recommended: true,
        },
        {
          id: 'low-risk-probe',
          title: '低风险试探',
          question: '最近总把熟悉的城市地标记错位置，怎样区分疲劳、记忆偏差和资料错误？',
          explanation: '这条问题不会透露方诺的血液差异或被测试经历，主要用于收集安全的自检方法和验证步骤。',
          informationValue: '低至中：能够获得调查方法，但不能直接验证世界规则是否发生变化。',
          risk: '低：看起来像普通的记忆与生活经验求助。',
          limitation: '回答可能集中在休息、就医等一般建议，难以触及异常本身。',
          recommended: false,
        },
      ],
      closing: '你没有替方诺决定真相，只替她决定了下一步该验证什么。故事给出答案之前，先提出一个经得起质证的问题。',
    },
    judgment: {
      playerWinner: '客观异常假说（本局论证更充分）',
      opponentWinner: '日常解释（本局暂未被排除）',
      award: '阶段裁决：现有线索足以排除“单纯记错常识”的解释，支持方诺保持隐蔽并继续调查世界异常。',
      lossAward: '阶段裁决：当前论证尚不足以排除疲劳、误认与巧合，需要补齐身体观察、定向测试和跟踪线索。',
      reasoning: '本局实际出示的四项材料形成了从身体异常、定向测试到外部异常方向的可质证链条，已不能只用疲劳、误记或单次巧合解释。结论仅覆盖公开片段，不预设原故事后续真相。',
      lossReasoning: '本局未能形成从身体异常、主动筛查到外部监控的完整线索链。',
      resultNote: '这是依据本局举证表现给出的阶段判断；证据链展示的是推理强弱，不预设故事后续真相。',
      disclaimer: '基于知乎故事公开接口片段的互动改编；故事及角色归原作者，游戏推演不代表原作结局。',
      sources: [{
        title: `知乎黑客松内容接口 · 《${title}》· ${author}`,
        article: introduction,
        url: FEATURED_STORY_ORIGINAL_URL,
        status: '知乎黑客松故事 API · 公开片段',
      }],
    },
    source: {
      provider: '知乎故事', workId, title, author, labels, artwork, introduction,
      apiUrl: storyApiUrl(workId), originalUrl: FEATURED_STORY_ORIGINAL_URL, mode, verifiedQuoteCount,
      notice: mode === 'zhihu-live' && verifiedQuoteCount
        ? `本案已实时核验 ${verifiedQuoteCount} 条知乎公开片段短引；完整正文不落盘，游戏推演不代表原作结局。`
        : mode === 'zhihu-live'
          ? '已读取知乎公开片段，但预设原文锚点未命中；当前仅展示策划转述，游戏推演不代表原作结局。'
        : '知乎接口当前不可用，本案暂用策划转述；恢复在线后会重新核验短引，游戏推演不代表原作结局。',
    },
  };
}

async function getStoryCase(value, client) {
  const workId = validateWorkId(value);
  if (workId !== FEATURED_STORY_ID) {
    const error = new Error('该故事尚未完成互动案卷编排');
    error.statusCode = 404;
    throw error;
  }
  try {
    const story = await client.getStory(workId);
    return buildBlueBloodCase(story, 'zhihu-live');
  } catch {
    return buildBlueBloodCase(featuredFallback, 'curated-fallback');
  }
}

module.exports = {
  FEATURED_STORY_ID,
  FEATURED_STORY_ORIGINAL_URL,
  STORY_CASE_PREFIX,
  buildBlueBloodCase,
  getStoryCase,
  listStoryChoices,
};
