/*
 * First project catalog (v0).
 * 7 everyday areas × small / medium / large, at least one project per cell, 25 total.
 * Each project: band, output, steps, done.
 * Preference tags: outputs (what you hold at the end), audience (who it's for).
 * words / keywords are literal matches against what the user typed, in English or Chinese.
 * Research-style projects stay a small slice (life-document, life-compare).
 */
(function () {
  'use strict';
  const QP = window.QP = window.QP || {};

  QP.DOMAINS = [
    { id: 'work', label: 'Work',
      words: ['工作', '上班', '职场', '同事', '老板', '领导', '求职', '面试', '简历', '副业', '客户',
        'at work', 'my job', 'coworker', 'boss', 'resume', 'client', 'salary', 'interview'] },
    { id: 'study', label: 'Learning',
      words: ['学习', '想学', '学会', '考试', '考证', '课程', '复习', '外语', '英语',
        'learn', 'learning', 'study', 'exam', 'course', 'language'] },
    { id: 'hobby', label: 'Hobbies',
      words: ['爱好', '兴趣', '游戏', '桌游', '追剧', '电影', '音乐', '乐器', '吉他', '钢琴', '摄影', '手工', '钓鱼',
        'hobby', 'movie', 'music', 'guitar', 'piano', 'photo', 'craft', 'game night'] },
    { id: 'life', label: 'Everyday life',
      words: ['生活', '家务', '做饭', '买菜', '省钱', '存钱', '花钱', '账单', '合同', '租房', '房东', '房租', '搬家', '理财', '装修',
        'chores', 'cooking', 'groceries', 'save money', 'bill', 'lease', 'rent', 'moving', 'budget'] },
    { id: 'create', label: 'Creating',
      words: ['创作', '写作', '写东西', '故事', '写诗', '画画', '设计', '视频', '文案', '写歌', '小说', '公众号', '小红书', '照片', '相册',
        'writing', 'story', 'poem', 'drawing', 'design', 'novel', 'social post', 'photo album'] },
    { id: 'health', label: 'Health',
      words: ['健康', '运动', '锻炼', '减肥', '睡眠', '失眠', '饮食', '看病', '医生', '身体', '健身', '体检',
        'health', 'exercise', 'workout', 'sleep', 'diet', 'doctor', 'fitness'] },
    { id: 'travel', label: 'Travel',
      words: ['旅行', '旅游', '出行', '度假', '出差', '行程', '机票', '酒店', '出去玩', '一日游', '自驾',
        'travel', 'trip', 'vacation', 'flight', 'hotel', 'itinerary'] }
  ];

  QP.OUTPUTS = [
    { id: 'text', label: 'Writing you can use', hint: 'a message, a post, a story, a card' },
    { id: 'list', label: 'A table or a list', hint: 'a comparison, a shopping list, a packing list' },
    { id: 'plan', label: 'A plan', hint: 'a study plan, a trip, a get-together' },
    { id: 'learn', label: 'Understand or practice one thing', hint: 'a concept, interview practice, exam prep' },
    { id: 'fun', label: 'Something fun to give or play', hint: 'a small game, a memory book, a note for someone' }
  ];

  QP.AUDIENCES = [
    { id: 'self', label: 'Myself' },
    { id: 'family', label: 'Family, friends, or kids' },
    { id: 'work', label: 'For work' }
  ];

  QP.PROJECTS = [
    {
      id: 'work-message', domain: 'work', band: 'small',
      outputs: ['text'], audience: ['work'],
      title: 'Write a work message you’ve been putting off',
      output: 'A message you can send (email or chat): a nudge, a no, time off, or a pay conversation.',
      steps: [
        'Tell the AI: “Help me write a message to (who). I want to say (what). I worry about (what).”',
        'Ask for two versions: one direct, one polite.',
        'Pick one, make it sound like you, and delete anything you wouldn’t say.'
      ],
      done: 'One message you can copy and send.',
      keywords: ['邮件', '消息', '回复', '请假', '催', '拒绝', '加薪', '涨薪', '老板', '同事', '客户', '沟通',
        'email', 'message', 'time off', 'raise', 'boss', 'coworker', 'client']
    },
    {
      id: 'work-checklist', domain: 'work', band: 'medium',
      outputs: ['list'], audience: ['work'],
      title: 'Turn a weekly chore into a checklist',
      output: 'A step-by-step list for something you repeat: a month-end check, a status note, or handing work to someone new.',
      steps: [
        'Tell the AI: “I do (this) every week. Ask me how I do it, one step at a time.”',
        'Answer, including the parts you forget or mess up.',
        'Ask for a numbered list. Each step says what you need and what “done” looks like.',
        'Walk the list against last time, add what was missing, and ask for a final version.'
      ],
      done: 'One page you can follow next time, and that a coworker can follow too.',
      keywords: ['清单', '流程', '交接', '周报', '重复', '新人', '对账', '报表', '步骤',
        'checklist', 'handoff', 'weekly update', 'steps']
    },
    {
      id: 'work-interview', domain: 'work', band: 'medium',
      outputs: ['learn'], audience: ['self'],
      title: 'Practice a job interview out loud',
      output: 'Notes from a practice round: 5 likely questions, each with your own answer points.',
      steps: [
        'Tell the AI the role and what you’ve done (paste the job post if you have it).',
        'Have it play interviewer and ask one question at a time. Answer as if it’s real.',
        'After each answer, ask what was solid and what should be more specific.',
        'Finish with the question you dread, and practice it once more.'
      ],
      done: 'One page of 5 answer points you can reread before the interview.',
      keywords: ['面试', '应聘', '求职', '找工作', '自我介绍', '复试', '跳槽',
        'interview', 'job hunt', 'hiring']
    },
    {
      id: 'work-job', domain: 'work', band: 'large',
      outputs: ['text', 'learn'], audience: ['self', 'work'],
      title: 'Rewrite a resume for one role, then practice the interview',
      output: 'A resume edited for this role, plus notes from a practice interview.',
      steps: [
        'Paste the old resume and the job post. Remove phone numbers, ID numbers, and your home address first.',
        'Ask where the resume misses the role, and edit one section at a time.',
        'Have it play interviewer for 8–10 questions. Answer them seriously.',
        'After each one, ask for notes and turn them into answer points.',
        'Read the resume once more. Every line should be true and sayable.'
      ],
      done: 'Resume text plus 8–10 answer points you can review before the interview.',
      keywords: ['简历', '面试', '求职', '找工作', '跳槽', '换工作', '职位', '应聘', 'offer',
        'resume', 'job', 'offer', 'career']
    },
    {
      id: 'study-concept', domain: 'study', band: 'small',
      outputs: ['learn'], audience: ['self', 'family'],
      title: 'Get clear on one idea you never quite got',
      output: 'A short explanation in your own words, plus one everyday example. Compound interest, a news term, a homework problem — anything.',
      steps: [
        'Tell the AI: “Explain (this) in plain language, with an everyday example. Skip the jargon.”',
        'Ask “what does that sentence mean?” wherever you stall.',
        'Ask for 3 small questions to check you.',
        'Explain it back in your own words and ask it to catch mistakes.'
      ],
      done: 'A short explanation you wrote, checked, and could tell someone else.',
      keywords: ['搞懂', '弄懂', '没懂', '概念', '解释', '什么意思', '作业', '原理', '复利', '通胀',
        'explain', 'concept', 'what does', 'homework']
    },
    {
      id: 'study-plan', domain: 'study', band: 'medium',
      outputs: ['plan', 'learn'], audience: ['self'],
      title: 'Make a 4-week plan to learn a skill',
      output: 'A 4-week plan: one goal each week, and a 15–30 minute practice for each day. Spreadsheets, a language, photos, cooking — anything.',
      steps: [
        'Say what you want to learn, your level now, and how many minutes you can spare.',
        'Ask for 4 weeks. Each week says what you can do by the end of it.',
        'Read each line. Make the hard ones easier, and swap anything you won’t do.',
        'Do day 1 with the AI before you close the tab.'
      ],
      done: 'A 4-week plan you can screenshot or print, with day 1 already done.',
      keywords: ['想学', '学会', '学做', '入门', '外语', '英语', '日语', 'excel', '表格', '技能', '自学', '课程', '吉他', '钢琴', '乐器', '游泳', '厨艺', '编程',
        'learn', 'guitar', 'piano', 'language', 'spreadsheet', 'skill', 'cook']
    },
    {
      id: 'study-flashcards', domain: 'study', band: 'large',
      outputs: ['learn', 'list'], audience: ['self'],
      title: 'Build a quiz deck and take a practice test',
      output: '40–60 question cards, one practice quiz, and notes on what you missed. A license test, a cert, vocabulary, onboarding — anything you have to remember.',
      steps: [
        'Say what the test or the list covers. Paste a table of contents or notes if you have them.',
        'Ask for cards in batches of 10–15. Delete the ones you don’t need.',
        'Ask for a 20-question quiz from the cards and answer it yourself.',
        'Send your answers back. For the ones you miss, ask for another explanation.',
        'Save the cards and the miss notes somewhere you can reuse.'
      ],
      done: 'A card list you can reuse, plus notes on what you still don’t know.',
      keywords: ['考试', '考证', '驾照', '背单词', '单词', '复习', '备考', '卡片', '测验', '记住',
        'exam', 'flashcard', 'vocabulary', 'quiz', 'license']
    },
    {
      id: 'hobby-picks', domain: 'hobby', band: 'small',
      outputs: ['list', 'fun'], audience: ['self'],
      title: 'Pick the next 5 things to watch or play',
      output: 'A list of 5: books, shows, films, games, or podcasts, each with why it fits you.',
      steps: [
        'Name 3 things you love and what you love about them.',
        'Name what you’re bored of, and tell it to skip those.',
        'Ask for 8 suggestions with reasons. Keep 5.',
        'Release dates, where to watch, and prices may be stale. Check before you start.'
      ],
      done: 'A list of 5, with reasons, so you can stop deciding for a while.',
      keywords: ['看什么', '玩什么', '看书', '读书', '电影', '电视剧', '追剧', '游戏', '播客', '动漫', '小说', '综艺',
        'what to watch', 'movie', 'show', 'game', 'podcast', 'book']
    },
    {
      id: 'hobby-party', domain: 'hobby', band: 'medium',
      outputs: ['plan', 'fun'], audience: ['family'],
      title: 'Plan a game night at home',
      output: 'A plan: a timeline, 2–3 games with short rules, and a food and shopping list.',
      steps: [
        'Say how many people, their ages, how long, the budget, and whether everyone knows each other.',
        'Ask for games that need little or no gear. Pick 2–3.',
        'Have the rules written so someone playing for the first time can follow.',
        'Make a start-to-end timeline and a shopping list.'
      ],
      done: 'One page: when, what you play, how, and what to buy.',
      keywords: ['聚会', '朋友', '派对', '游戏之夜', '桌游', '剧本杀', '生日', '狼人杀', '团建',
        'party', 'game night', 'friends', 'birthday']
    },
    {
      id: 'hobby-game', domain: 'hobby', band: 'large',
      outputs: ['fun'], audience: ['family'],
      title: 'Design a small game to play with people you know',
      output: 'A printable game: one page of rules, plus the text for every card or prompt. A board game, a puzzle, a scavenger hunt, or a family quiz.',
      steps: [
        'Pick a theme, how many players, how long, and who it’s for.',
        'Ask for 3 ways to play. Choose one.',
        'Write the rules together, then the text for every card or prompt.',
        'Have the AI pretend to be 3 players and play once, looking for holes in the rules.',
        'Fix the holes and save the final version.'
      ],
      done: 'One page of rules plus every card or prompt, ready to print and cut.',
      keywords: ['桌游', '游戏', '解谜', '谜题', '寻宝', '问答', '孩子', '家庭游戏',
        'board game', 'puzzle', 'scavenger', 'family game']
    },
    {
      id: 'life-meals', domain: 'life', band: 'small',
      outputs: ['list', 'plan'], audience: ['self', 'family'],
      title: 'Plan the next three meals from what you have',
      output: 'Three meals with short methods, plus a shopping list of only what’s missing.',
      steps: [
        'List what’s in the kitchen, how many people, and what anyone won’t eat.',
        'Ask for three meals. Each method should be 5 steps or fewer.',
        'Ask for the missing items only, as few as possible.'
      ],
      done: 'Three meals you can cook, plus a short shopping list.',
      keywords: ['做饭', '做菜', '吃什么', '冰箱', '菜谱', '食谱', '买菜', '晚饭', '午饭', '早餐', '带饭',
        'dinner', 'recipe', 'groceries', 'lunch', 'breakfast']
    },
    {
      id: 'life-document', domain: 'life', band: 'medium',
      outputs: ['learn', 'list'], audience: ['self'],
      title: 'Make sense of a document that’s giving you trouble',
      output: 'One plain-language page: what it says, what to watch, and what to ask. A lease, a policy, a bill, or a notice.',
      steps: [
        'Replace names, ID numbers, phone numbers, addresses, and account numbers with XXX before you paste.',
        'Ask for a plain-language walkthrough, one section at a time.',
        'Ask: “What here is bad for me, or easy to miss?”',
        'Ask for questions to take back to the other side. For a real decision, still ask a person who does this for a living.'
      ],
      done: 'One page of notes plus questions, so you know what to ask.',
      keywords: ['合同', '租房', '房东', '房租', '涨租', '保险', '条款', '账单', '通知', '文件', '协议', '看不懂', '政策',
        'lease', 'landlord', 'rent', 'insurance', 'bill', 'contract']
    },
    {
      id: 'life-compare', domain: 'life', band: 'medium',
      outputs: ['list'], audience: ['self'],
      title: 'Compare three options before a big purchase',
      output: 'A table: 3 options × the 5 things you care about, plus one sentence on what you’ll do and why. An appliance, a phone, a plan, a class.',
      steps: [
        'Say your budget, what it’s for, and the 5 things you care about.',
        'Name 3 options (a model name, or paste the description).',
        'Ask for a comparison table and the downside of each.',
        'Prices and model names go stale. Check the important numbers yourself before you buy.'
      ],
      done: 'A checked comparison table plus one written decision.',
      keywords: ['想买', '要买', '买车', '买哪个', '选哪个', '比较', '对比', '家电', '手机', '电脑', '套餐', '值不值',
        'buy a car', 'which one', 'compare', 'phone', 'laptop']
    },
    {
      id: 'life-budget', domain: 'life', band: 'large',
      outputs: ['list', 'plan'], audience: ['self'],
      title: 'See where last month’s money went and set next month’s budget',
      output: 'Spending by category, a budget for next month, and 3 cuts you can make now.',
      steps: [
        'From your bank or payment app, copy last month’s amounts and what they were for. Don’t copy card or account numbers.',
        'Ask the AI to group them: food, transit, rent, shopping, subscriptions.',
        'Find the 3 biggest groups. Say which are necessary and which can shrink.',
        'Set a cap for each group next month.',
        'Write 3 specific cuts, such as “cancel a subscription I don’t use.”'
      ],
      done: 'A category table, next month’s budget, and 3 cuts.',
      keywords: ['预算', '省钱', '记账', '花钱', '开销', '存钱', '理财', '工资', '月光',
        'budget', 'save money', 'spending', 'subscription']
    },
    {
      id: 'create-card', domain: 'create', band: 'small',
      outputs: ['text', 'fun'], audience: ['family'],
      title: 'Write a few honest lines for someone who matters',
      output: 'A short note in your voice for a card, a birthday, or a thank-you.',
      steps: [
        'Say who it’s for, the occasion, and one or two small memories.',
        'Ask for 3 versions: warm, playful, and short.',
        'Pick one, cut anything you wouldn’t say, and add a real detail.'
      ],
      done: 'A note you can write on a card or send.',
      keywords: ['生日', '祝福', '贺卡', '感谢', '道歉', '表白', '纪念日', '父亲节', '母亲节', '新年', '妈妈', '爸爸',
        'birthday', 'thank you', 'card', 'mom', 'dad']
    },
    {
      id: 'create-story', domain: 'create', band: 'medium',
      outputs: ['text', 'fun'], audience: ['family', 'self'],
      title: 'Write a short story with a beginning, middle, and end',
      output: 'A 1,000–2,000 word story. A bedtime story, or one for yourself.',
      steps: [
        'Pick a character, a place, and one small problem.',
        'Ask for 3 directions. Choose one.',
        'Write it in pieces: you say what happens next, it drafts, you edit.',
        'Read it through and ask which lines feel stiff. Revise those.'
      ],
      done: 'A finished story you could read aloud.',
      keywords: ['故事', '小说', '睡前', '童话', '写作', '写东西', '孩子',
        'story', 'bedtime', 'fiction', 'fairy tale']
    },
    {
      id: 'create-posts', domain: 'create', band: 'medium',
      outputs: ['text'], audience: ['self', 'work'],
      title: 'Draft next week’s 5 posts',
      output: '5 posts: a title, the text, and an image idea for each.',
      steps: [
        'Say what the account is for, who reads it, and how you sound. Paste an old post if you have one.',
        'Ask for 10 topics. Keep the 5 you actually want to write.',
        'Write them one at a time. Edit each into your voice and add something that happened to you.',
        'Ask for a title and an image idea for each, then an order to post them.'
      ],
      done: '5 edited posts saved, one to copy each day next week.',
      keywords: ['小红书', '公众号', '朋友圈', '抖音', '视频号', '发帖', '账号', '涨粉', '文案', '小店',
        'social post', 'caption', 'newsletter', 'account']
    },
    {
      id: 'create-memory-book', domain: 'create', band: 'large',
      outputs: ['text', 'fun'], audience: ['family'],
      title: 'Write the text for a memory book',
      output: 'Text for about 10 pages: a title and a paragraph per page, which photo goes there, plus an opening and a close.',
      steps: [
        'List about 10 memories (an event, a photo, or a line someone said).',
        'Ask for an order and a title for each page.',
        'Write one page at a time: you supply the detail, it drafts a paragraph, you put it in your words.',
        'Write the opening and the close.',
        'Read the whole thing. Make the voice consistent and cut repeats.'
      ],
      done: 'A full text you can lay out, put in an album, or copy by hand.',
      keywords: ['纪念册', '相册', '回忆', '照片', '毕业', '婚礼', '结婚', '退休', '纪念', '送礼', '家人',
        'memory book', 'album', 'wedding', 'graduation']
    },
    {
      id: 'health-week', domain: 'health', band: 'small',
      outputs: ['plan'], audience: ['self'],
      title: 'Put three workouts on this week’s calendar',
      output: 'Three sessions this week, 20–30 minutes each, fitted to your body and your free time.',
      steps: [
        'Say which hours are free, how much you usually move, and whether anything hurts.',
        'Ask for 3 sessions you can do at home or nearby. Each one says what to do and for how long.',
        'Put the 3 on your calendar. If you’re injured, ask a clinician before you start.'
      ],
      done: 'Three calendar entries, each saying what you’ll do.',
      keywords: ['运动', '锻炼', '健身', '跑步', '散步', '瑜伽', '久坐', '动一动',
        'workout', 'run', 'walk', 'yoga']
    },
    {
      id: 'health-doctor', domain: 'health', band: 'medium',
      outputs: ['list'], audience: ['self', 'family'],
      title: 'Prepare what you’ll say at the next appointment',
      output: 'One page to take with you: what happened, in order, what you’ve taken, and what you want to ask.',
      steps: [
        'In order, say when it started, what it feels like, what you’ve tried, and what you’ve taken.',
        'Ask for a clear timeline.',
        'Ask for questions a clinician might expect. Keep the 5 you most want answered.',
        'This only helps you say it clearly. It is not a diagnosis. Treatment comes from the clinician.'
      ],
      done: 'One page you can screenshot or print, so you don’t go blank in the room.',
      keywords: ['看病', '医生', '医院', '症状', '体检', '复诊', '吃药', '不舒服', '检查', '挂号',
        'doctor', 'appointment', 'symptom', 'clinic']
    },
    {
      id: 'health-eating', domain: 'health', band: 'medium',
      outputs: ['list', 'plan'], audience: ['self'],
      title: 'Look at three days of meals and pick 3 habits to change',
      output: 'A three-day food log, plus 3 small changes you’ll actually try, each with a swap.',
      steps: [
        'From memory, list what you ate and drank for three days. Rough times and amounts are enough.',
        'Ask for a table and the easiest things to change (late snacks, sugary drinks, skipping breakfast).',
        'Pick 3 you will actually try. Ask for a specific swap for each.',
        'This shows habits. It is not medical care. If you have a condition, take medication, or are pregnant, ask a clinician before you change how you eat.'
      ],
      done: 'A three-day table plus 3 swaps you can start tomorrow.',
      keywords: ['减肥', '饮食', '吃得', '外卖', '零食', '体重', '减脂', '控糖', '夜宵', '奶茶',
        'lose weight', 'diet', 'snacks', 'takeout']
    },
    {
      id: 'health-month', domain: 'health', band: 'large',
      outputs: ['plan', 'list'], audience: ['self'],
      title: 'Make a 4-week plan for meals and movement',
      output: 'Four weeks: how you’ll eat, how you’ll move, a weekly shopping list, and a simple check-off sheet.',
      steps: [
        'Say the goal (sleep, fewer takeout meals, moving more), your schedule, whether you cook, and your budget.',
        'Plan week 1 first. Change anything you won’t do.',
        'Then weeks 2–4, each one a small step past the last.',
        'Ask for a weekly shopping list and a check-off sheet.',
        'If you have a condition, take medication, or are pregnant, show the plan to a clinician first.'
      ],
      done: 'A 4-week plan, a shopping list, and a check-off sheet.',
      keywords: ['减肥', '饮食', '睡眠', '外卖', '减脂', '增肌', '作息', '体重', '养生', '健康',
        'lose weight', 'sleep', 'meal plan', 'routine']
    },
    {
      id: 'travel-packing', domain: 'travel', band: 'small',
      outputs: ['list'], audience: ['self', 'family'],
      title: 'Make a packing list for this trip',
      output: 'A packing list for these days, this weather, and what you’ll actually do.',
      steps: [
        'Say where, how many days, who is going, and what you’ll do.',
        'Ask for a list grouped as documents and money / clothes / wash kit / electronics / medicine.',
        'Delete what you won’t use. Add what you always forget. Check the forecast yourself before you go.'
      ],
      done: 'A list you can tick the morning you leave.',
      keywords: ['打包', '行李', '出差', '出门', '带什么',
        'packing', 'luggage', 'what to pack']
    },
    {
      id: 'travel-day-trip', domain: 'travel', band: 'medium',
      outputs: ['plan', 'fun'], audience: ['self', 'family'],
      title: 'Plan a one-day outing',
      output: 'One day: when, where, how you get there, where you eat, and a backup if it rains.',
      steps: [
        'Say where you start, the area you want, how many people, what you like, and the budget.',
        'Ask for a route and a timeline.',
        'Ask for a rain backup.',
        'Hours, ticket prices, and transit may be stale. Check a map and the official page before you go.'
      ],
      done: 'A checked one-day plan plus a backup.',
      keywords: ['周末', '一日游', '出去玩', '郊游', '遛娃', '逛街', '约会', '短途',
        'day trip', 'weekend', 'outing']
    },
    {
      id: 'travel-trip', domain: 'travel', band: 'large',
      outputs: ['plan'], audience: ['self', 'family'],
      title: 'Plan a 5–7 day trip',
      output: 'A full plan: each day, a budget, what to book or arrange, and a page for if something goes wrong.',
      steps: [
        'Say where, how many days, who is going, the budget, the pace, and what you must or won’t do.',
        'Ask for a rough day-by-day plan and adjust it until it feels right.',
        'Ask for a budget: transit, lodging, food, tickets, and a buffer.',
        'List what to do before you leave: tickets, documents, insurance, cash.',
        'Make one page of backup info (where you’re staying, what to do if a document is lost). Check visas and prices on the official sites yourself.'
      ],
      done: 'A plan you can follow, a budget, and a before-you-go list.',
      keywords: ['旅行', '旅游', '出国', '度假', '行程', '签证', '自由行', '攻略', '假期', '蜜月', '日本',
        'travel', 'vacation', 'itinerary', 'visa', 'japan']
    }
  ];
})();
