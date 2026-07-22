export interface MockStat {
	id: 'health' | 'inbox' | 'task-flow';
	label: string;
	value: string;
	unit: string;
	note: string;
	icon: string;
}

export interface MockGitHubItem {
	repo: string;
	description: string;
	stars: string;
	updated: string;
}

export interface MockScene {
	name: string;
	alt: string;
	svg: string;
}

export const DASHBOARD_ACTIONS = [
	{ id: 'diary', label: '日记', comingSoon: false },
	{ id: 'project-log', label: '项目日志', comingSoon: false },
	{ id: 'inbox', label: '收件箱导入', comingSoon: false },
	{ id: 'vault-check', label: '知识库检查', comingSoon: false },
	{ id: 'deep-research', label: '深度研究', comingSoon: true },
	{ id: 'rss', label: '拉取 RSS 订阅', comingSoon: true },
	{ id: 'github', label: 'GitHub 动态', comingSoon: true },
] as const;

export const MOCK_STATS: MockStat[] = [
	{ id: 'health', label: '知识库健康度', value: '—', unit: '/100', note: '正在计算真实数据', icon: 'activity' },
	{ id: 'inbox', label: '收件箱积压', value: '17', unit: '个文件', note: '等待整理的笔记与资料', icon: 'inbox' },
	{ id: 'task-flow', label: '任务流', value: '0', unit: '已完成', note: '正在读取真实任务', icon: 'circle-check' },
];

export const MOCK_BRIEF = [
	{ tone: 'sage', index: '01', title: '今天最重要', text: '完成仪表盘原型评审，并确认第一版真实数据范围。' },
	{ tone: 'blue', index: '02', title: '值得回顾', text: '深度研究有 3 条引用待复核，收件箱有 4 条笔记待路由。' },
	{ tone: 'rose', index: '03', title: 'Agent 等待中', text: '项目日志工作流需要确认输出目录后继续。' },
] as const;

export const MOCK_GITHUB_FEED: MockGitHubItem[] = [
	{ repo: 'obsidianmd/obsidian-api', description: '插件 API 类型定义与更新记录', stars: '1.8k', updated: '18 分钟前更新' },
	{ repo: 'anthropics/skills', description: '面向智能体工作流的可复用技能模式', stars: '42.6k', updated: '1 小时前更新' },
	{ repo: 'ruibin/agent-notes', description: '主分支新增三份会话摘要', stars: '24', updated: '2 小时前推送' },
	{ repo: 'kepano/obsidian-minimal', description: '优化紧凑元数据的主题显示', stars: '3.9k', updated: '昨天发布' },
	{ repo: 'blacksmithgu/obsidian-dataview', description: '查询引擎讨论等待审阅', stars: '8.9k', updated: '2 天前更新' },
];

export const MOCK_COVER_SCENES: MockScene[] = [
	{
		name: '晨雾松林',
		alt: '晨雾中的森林与远山',
		svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 480"><rect width="1600" height="480" fill="#b9cbbd"/><circle cx="1280" cy="90" r="78" fill="#e8ead2" opacity=".82"/><path d="M0 278 250 130l210 126 245-178 255 190 250-138 390 166v184H0Z" fill="#7e9d87"/><path d="M0 326 280 210l190 96 235-142 260 150 242-108 393 138v136H0Z" fill="#5f806b" opacity=".92"/><path d="M0 370c180-58 320-36 470-5 185 38 308-12 470-30 218-25 396 10 660 80v65H0Z" fill="#dce5dc" opacity=".74"/><g fill="#355c45"><path d="m130 350 38-115 38 115h-24v70h-28v-70Z"/><path d="m250 374 48-146 48 146h-31v62h-34v-62Z"/><path d="m1250 380 52-158 52 158h-33v62h-37v-62Z"/></g></svg>',
	},
	{
		name: '湖岸晨光',
		alt: '晨光照亮平静湖岸与芦苇',
		svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 480"><rect width="1600" height="480" fill="#b7ced0"/><circle cx="330" cy="105" r="74" fill="#f2dfaa" opacity=".9"/><path d="M0 250 255 135l205 92 215-130 290 160 215-92 420 125v190H0Z" fill="#7d9e91"/><path d="M0 312c230-40 440-28 666 16 264 52 538 16 934-40v192H0Z" fill="#8fb3b0"/><path d="M0 368c320 28 610-18 860-4 282 16 468 48 740 27v89H0Z" fill="#d9e5df" opacity=".8"/></svg>',
	},
	{
		name: '林冠微风',
		alt: '阳光穿过绿色树冠与摇曳枝叶',
		svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 480"><rect width="1600" height="480" fill="#d6dfbd"/><circle cx="790" cy="170" r="125" fill="#f3e4ae" opacity=".72"/><g fill="#668b62"><circle cx="40" cy="90" r="180"/><circle cx="205" cy="35" r="145"/><circle cx="370" cy="82" r="160"/><circle cx="1260" cy="42" r="175"/><circle cx="1440" cy="108" r="210"/></g><g fill="#88a776"><ellipse cx="510" cy="92" rx="130" ry="68"/><ellipse cx="1080" cy="104" rx="150" ry="70"/><ellipse cx="630" cy="300" rx="180" ry="78"/></g><path d="M0 416c260-72 468-48 694-10 274 46 560-18 906-82v156H0Z" fill="#496d51" opacity=".8"/></svg>',
	},
];

export const MOCK_AVATAR_SCENES: MockScene[] = [
	{ name: '松林', alt: '绿色松林头像', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="42" fill="#dce5dc"/><circle cx="100" cy="82" r="42" fill="#71877a"/><path d="M35 188c8-47 34-70 65-70s57 23 65 70" fill="#536b5d"/><path d="m25 85 30-63 30 63H68v42H43V85Z" fill="#8da091" opacity=".8"/></svg>' },
	{ name: '湖光', alt: '蓝灰湖光头像', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="42" fill="#e6ebef"/><circle cx="100" cy="78" r="42" fill="#74879a"/><path d="M32 188c10-45 35-68 68-68s58 23 68 68" fill="#5f7182"/><circle cx="38" cy="40" r="22" fill="#d7c99e"/></svg>' },
	{ name: '暖砂', alt: '暖砂色抽象头像', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="42" fill="#f0e8e5"/><circle cx="100" cy="78" r="42" fill="#a9837a"/><path d="M32 188c10-45 35-68 68-68s58 23 68 68" fill="#80655f"/><path d="M20 38h62L50 94Z" fill="#c2ad8b" opacity=".65"/></svg>' },
];
