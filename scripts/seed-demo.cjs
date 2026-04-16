/**
 * Seed demo data for discovered_content and social_posts.
 *
 * ~30 discovered content items across 4 topics + 5 platforms
 * ~12 social posts spread over 2 weeks for calendar demo
 *
 * Usage: npx electron --no-sandbox scripts/seed-demo.cjs
 *
 * Must run through Electron's Node to match the native module version.
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const os = require('os');

// Resolve DB path same as the app
const userDataPath =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'neon-post')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'neon-post')
      : path.join(os.homedir(), '.config', 'neon-post');

const dbPath = path.join(userDataPath, 'neon-post.db');
console.log('Seeding DB at:', dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ── Helpers ──

function uuid() {
  return crypto.randomUUID();
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(10 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

// ── Discovered Content ──

const insertContent = db.prepare(`
  INSERT OR IGNORE INTO discovered_content
    (id, platform, source_url, source_author, content_type, title, body, likes, comments, shares, views, viral_score, viral_tier, discovered_at, tags, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const contentItems = [
  // Topic 1: AI tools / AI automation (8 items — should cluster)
  { platform: 'tiktok', author: '@aitools_daily', title: 'This AI tool writes your emails in 2 seconds', body: 'AI automation is changing how we work. This tool uses GPT to draft emails instantly. AI productivity hack.', likes: 85000, comments: 3200, shares: 15000, views: 1200000, tags: 'ai,automation,productivity,tools', age: 1 },
  { platform: 'tiktok', author: '@techguru', title: 'Stop sleeping on AI automation tools', body: 'AI automation tools that save 10 hours per week. Best AI tools for content creators.', likes: 42000, comments: 1800, shares: 8000, views: 650000, tags: 'ai,automation,tools,creator', age: 2 },
  { platform: 'instagram', author: '@futureofwork', title: 'AI tools every creator needs in 2026', body: 'Top 5 AI tools for automation. These AI automation platforms changed my workflow completely.', likes: 12000, comments: 890, shares: 2100, views: 95000, tags: 'ai,tools,automation,creator', age: 1 },
  { platform: 'youtube', author: '@mattvidpro', title: 'I tested 50 AI tools so you dont have to', body: 'Comprehensive AI tools review. Best automation tools for productivity and content creation.', likes: 28000, comments: 4500, shares: 3200, views: 890000, tags: 'ai,tools,review,automation', age: 3 },
  { platform: 'twitter', author: '@elonmusk_fan', title: 'AI automation will replace 80% of desk jobs', body: 'Hot take: AI tools and automation are advancing faster than anyone predicted.', likes: 5600, comments: 2300, shares: 4100, views: 0, tags: 'ai,automation,future', age: 1 },
  { platform: 'linkedin', author: 'Sarah Chen', title: 'How AI automation transformed our startup', body: 'We integrated AI tools into every department. AI automation reduced costs by 40%.', likes: 3200, comments: 450, shares: 890, views: 0, tags: 'ai,automation,startup,tools', age: 2 },
  { platform: 'tiktok', author: '@codingwithkai', title: 'AI coding tools that actually work', body: 'Best AI tools for developers. AI automation for code review and testing.', likes: 33000, comments: 1500, shares: 5500, views: 480000, tags: 'ai,tools,coding,automation', age: 4 },
  { platform: 'instagram', author: '@productivityhacks', title: 'AI automation morning routine', body: 'Using AI tools to automate my entire morning. Scheduling, emails, content — all AI.', likes: 8500, comments: 620, shares: 1400, views: 67000, tags: 'ai,automation,routine,productivity', age: 3 },

  // Topic 2: Short form video / hooks (7 items — should cluster)
  { platform: 'tiktok', author: '@hookmaster', title: 'The hook that got me 10M views', body: 'Short form video hooks that stop the scroll. This hook formula works every time for viral content.', likes: 120000, comments: 5600, shares: 22000, views: 2500000, tags: 'hooks,viral,shortform,video', age: 0.5 },
  { platform: 'tiktok', author: '@contentcreator', title: '5 hooks that go viral every time', body: 'Short form video hook formulas. These hooks guarantee engagement on your videos.', likes: 67000, comments: 2900, shares: 11000, views: 980000, tags: 'hooks,viral,shortform,content', age: 1 },
  { platform: 'instagram', author: '@reelstrategy', title: 'Hook formulas for Reels that pop', body: 'The best hooks for short form video content. Stop the scroll with these proven hooks.', likes: 15000, comments: 1100, shares: 3200, views: 120000, tags: 'hooks,reels,shortform,video', age: 2 },
  { platform: 'youtube', author: '@filmbootcamp', title: 'Why your short form videos fail (its the hook)', body: 'Short form content strategy. The hook is 80% of your video performance.', likes: 19000, comments: 3800, shares: 2800, views: 540000, tags: 'hooks,shortform,video,strategy', age: 3 },
  { platform: 'twitter', author: '@garyvee', title: 'Your hook is everything. Stop burying the lead.', body: 'Short form video tip: lead with the hook. Every viral video has a killer opening.', likes: 8900, comments: 1200, shares: 3600, views: 0, tags: 'hooks,shortform,video,advice', age: 1 },
  { platform: 'tiktok', author: '@viralcoach', title: 'POV: you finally learn hook writing', body: 'Hook formulas that work for any niche. Short form video hooks decoded.', likes: 55000, comments: 2100, shares: 9500, views: 750000, tags: 'hooks,shortform,viral,formula', age: 2 },
  { platform: 'linkedin', author: 'James Wright', title: 'I analyzed 1000 viral hooks. Heres what I found.', body: 'Data-driven hook analysis for short form video content.', likes: 4500, comments: 680, shares: 1200, views: 0, tags: 'hooks,shortform,data,viral', age: 4 },

  // Topic 3: Monetization / creator economy (8 items — should cluster)
  { platform: 'youtube', author: '@grahamstephan', title: 'How I made $2M from YouTube this year', body: 'Creator monetization breakdown. Revenue streams beyond ads: sponsorships, courses, affiliates.', likes: 45000, comments: 6200, shares: 5100, views: 1800000, tags: 'monetization,creator,revenue,youtube', age: 2 },
  { platform: 'tiktok', author: '@moneycoach', title: 'Creator economy is printing money right now', body: 'Monetization strategies for creators in 2026. Multiple revenue streams explained.', likes: 38000, comments: 1600, shares: 7200, views: 520000, tags: 'monetization,creator,economy,money', age: 1 },
  { platform: 'instagram', author: '@bizofcontent', title: 'Stop leaving money on the table as a creator', body: 'Creator monetization mistakes. Revenue optimization for content creators.', likes: 9800, comments: 730, shares: 1900, views: 78000, tags: 'monetization,creator,revenue,tips', age: 3 },
  { platform: 'twitter', author: '@jackbutcher', title: 'The creator economy is a $250B market. Are you in?', body: 'Creator economy stats and monetization opportunities for 2026.', likes: 6700, comments: 890, shares: 2800, views: 0, tags: 'creator,economy,monetization,market', age: 2 },
  { platform: 'linkedin', author: 'Maria Lopez', title: 'Why creators are the new entrepreneurs', body: 'Creator economy insights. Monetization, brand deals, and sustainable creator businesses.', likes: 2800, comments: 340, shares: 670, views: 0, tags: 'creator,economy,monetization,business', age: 5 },
  { platform: 'youtube', author: '@aliabdaal', title: 'My honest creator income report (month 48)', body: 'Full monetization transparency. Creator revenue: ads, sponsors, products, courses.', likes: 32000, comments: 4100, shares: 3800, views: 1200000, tags: 'monetization,creator,income,transparency', age: 1 },
  { platform: 'tiktok', author: '@sidehustlequeen', title: 'Creator fund vs brand deals — which pays more?', body: 'Monetization comparison for creators. Creator economy revenue breakdown.', likes: 24000, comments: 1100, shares: 4300, views: 340000, tags: 'monetization,creator,fund,brands', age: 3 },
  { platform: 'instagram', author: '@influencerbiz', title: '6 revenue streams every creator needs', body: 'Creator monetization diversification. Dont rely on one income stream.', likes: 7200, comments: 510, shares: 1600, views: 54000, tags: 'monetization,creator,revenue,diversify', age: 2 },

  // Topic 4: Some low-engagement noise (to test low scores)
  { platform: 'twitter', author: '@randomuser42', title: 'Just had a great sandwich', body: 'Nothing special just vibes.', likes: 12, comments: 2, shares: 0, views: 0, tags: 'food,random', age: 6 },
  { platform: 'instagram', author: '@catphotos99', title: 'My cat sleeping again', body: 'Cute cat content.', likes: 45, comments: 8, shares: 3, views: 200, tags: 'cats,pets', age: 5 },
  { platform: 'tiktok', author: '@newbie_creator', title: 'Day 1 of posting every day', body: 'Starting my content journey.', likes: 80, comments: 15, shares: 5, views: 1200, tags: 'journey,day1', age: 7 },
];

const now = new Date().toISOString();
const insertMany = db.transaction(() => {
  for (const item of contentItems) {
    const disc = daysAgo(item.age);
    insertContent.run(
      uuid(), item.platform, `https://${item.platform}.com/${item.author}/post-${Math.floor(Math.random() * 99999)}`,
      item.author, 'post', item.title, item.body,
      item.likes, item.comments, item.shares, item.views,
      null, null, // viral_score/tier — will be computed by the app
      disc, item.tags, now, now
    );
  }
});

insertMany();
console.log(`Inserted ${contentItems.length} discovered content items`);

// ── Social Posts (for calendar) ──

const insertPost = db.prepare(`
  INSERT OR IGNORE INTO social_posts
    (id, platform, status, content, scheduled_at, posted_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const posts = [
  // Past posted
  { platform: 'tiktok', status: 'posted', content: 'AI tools that changed my workflow forever #ai #productivity', daysOffset: -5 },
  { platform: 'instagram', status: 'posted', content: 'Hook formula breakdown - save this for later', daysOffset: -3 },
  { platform: 'youtube', status: 'posted', content: 'Full monetization guide for new creators (2026 edition)', daysOffset: -2 },
  { platform: 'twitter', status: 'posted', content: 'The creator economy isnt slowing down. Heres proof.', daysOffset: -1 },

  // Today
  { platform: 'tiktok', status: 'scheduled', content: '3 hooks that ALWAYS go viral - watch till the end', daysOffset: 0 },
  { platform: 'linkedin', status: 'draft', content: 'How we automated 60% of our content pipeline using AI tools', daysOffset: 0 },

  // Future scheduled
  { platform: 'instagram', status: 'scheduled', content: 'Creator monetization tier list - which revenue stream wins?', daysOffset: 2 },
  { platform: 'tiktok', status: 'scheduled', content: 'Stop making this hook mistake (its killing your views)', daysOffset: 3 },
  { platform: 'youtube', status: 'scheduled', content: 'I tested every AI automation tool for a week', daysOffset: 5 },
  { platform: 'twitter', status: 'scheduled', content: 'Thread: 10 underrated AI tools for content creators', daysOffset: 5 },
  { platform: 'instagram', status: 'scheduled', content: 'Short form video checklist for maximum reach', daysOffset: 7 },
  { platform: 'tiktok', status: 'draft', content: 'What nobody tells you about the creator fund', daysOffset: 10 },
];

const insertPosts = db.transaction(() => {
  for (const post of posts) {
    const ts = daysFromNow(post.daysOffset);
    insertPost.run(
      uuid(), post.platform, post.status, post.content,
      post.status === 'scheduled' ? ts : null,
      post.status === 'posted' ? ts : null,
      now, now
    );
  }
});

insertPosts();
console.log(`Inserted ${posts.length} social posts`);

db.close();
console.log('Done! Restart the app to see the data.');
