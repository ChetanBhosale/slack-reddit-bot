import Snoowrap from "snoowrap";
import dotenv from "dotenv";
import fs from "fs/promises";
import { WebClient } from "@slack/web-api";
import cron from "node-cron";

dotenv.config();

const reddit = new Snoowrap({
  userAgent: "linkrunner-reddit-bot/1.0.0 by u/your_reddit_username",
  clientId: process.env.REDDIT_CLIENT_ID!,
  clientSecret: process.env.REDDIT_CLIENT_SECRET!,
  username: process.env.REDDIT_USERNAME!,
  password: process.env.REDDIT_PASSWORD!,
});

const slackClient = new WebClient(process.env.SLACK_SECRET);
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;

const SUBREDDITS = [
  "startup",
  "mobilemarketing",
  "marketing",
  "Entrepreneur",
  "SaaS",
  "growthhacking",
  "AppMarketing",
  "mobileapps",
  "learnprogramming",
  "webdev",
  "indiehackers",
  "androiddev",
  "iOSProgramming",
  "reactnative",
  "digitalnomad",
  "SideProject",
  "IMadeThis",
  "smallbusiness",
  "EntrepreneurRideAlong",
  "startups",
  "marketing_digital",
  "AskMarketing",
  "socialmedia",
  "PPC",
  "analytics",
  "AppIdeas",
  "AppBusiness",
];

const KEYWORDS = [
  "attribution",
  "mmp",
  "deep link",
  "deeplink",
  "app install tracking",
  "mobile measurement",
  "appsflyer",
  "branch io",
  "adjust",
  "marketing campaign",
  "mobile analytics",
  "cpi",
  "user acquisition",
  "marketing roi",
  "track installs",
  "utm tracking",
  "firebase analytics issue",
  "campaign tracking issue",
  "mobile marketing tool",
];

const HISTORY_FILE = "./history.json";
const POST_LIMIT = 40;
const DELAY_BETWEEN_SUBREDDITS = 60000;

async function loadHistory(): Promise<Set<string>> {
  try {
    const data = await fs.readFile(HISTORY_FILE, "utf-8");
    return new Set(JSON.parse(data));
  } catch {
    return new Set();
  }
}

async function saveHistory(history: Set<string>) {
  await fs.writeFile(HISTORY_FILE, JSON.stringify([...history], null, 2));
}

function containsKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendToSlack(posts: { title: string; url: string; subreddit: string }[]) {
  if (!slackClient || !SLACK_CHANNEL_ID) return;
  const messageBlocks = posts.map((p) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*<${p.url}|[${p.subreddit}] ${p.title}>*`,
    },
  }));

  await slackClient.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    text: `${posts.length} new relevant Reddit posts found!`,
    blocks: messageBlocks,
  });

  console.log("Sent new posts to Slack!");
}

async function fetchPosts() {
  const startTime = new Date().toLocaleString();
  console.log(`\nStarting fetch at ${startTime}`);
  
  const history = await loadHistory();
  console.log(`History loaded: ${history.size} posts tracked`);
  
  const newPosts: { title: string; url: string; subreddit: string }[] = [];

  for (let i = 0; i < SUBREDDITS.length; i++) {
    const sub = SUBREDDITS[i]!;
    console.log(`\n[${i + 1}/${SUBREDDITS.length}] Fetching r/${sub}...`);
    
    try {
      const posts = await reddit.getSubreddit(sub).getHot({ limit: POST_LIMIT });
      console.log(`Fetched ${posts.length} posts from r/${sub}`);
      
      let foundInSub = 0;
      for (const post of posts) {
        if (
          !history.has(post.id) &&
          containsKeyword(post.title + " " + post.selftext)
        ) {
          newPosts.push({
            title: post.title,
            url: `https://reddit.com${post.permalink}`,
            subreddit: sub,
          });
          history.add(post.id);
          foundInSub++;
        }
      }
      
      if (foundInSub > 0) {
        console.log(`  > Found ${foundInSub} relevant post(s)`);
      }
    } catch (error) {
      console.error(`ERROR fetching r/${sub}:`, error);
    }

    if (i < SUBREDDITS.length - 1) {
      console.log(`Waiting 1 minute before next subreddit...`);
      await delay(DELAY_BETWEEN_SUBREDDITS);
    }
  }

  if (newPosts.length > 0) {
    console.log(`\nFound ${newPosts.length} new relevant posts:\n`);
    newPosts.forEach((p) =>
      console.log(`[${p.subreddit}] ${p.title}\n  ${p.url}\n`)
    );

    try {
      await sendToSlack(newPosts);
    } catch (error) {
      console.error("Failed to send to Slack:", error);
    }
  } else {
    console.log("\nNo new relevant posts found this run.");
  }

  await saveHistory(history);
  console.log(`Fetch completed at ${new Date().toLocaleString()}`);
}

console.log("Reddit Bot starting...");
fetchPosts().catch(console.error);

cron.schedule("0 12 * * *", () => {
  console.log("\nCron job triggered");
  fetchPosts().catch(console.error);
});

console.log("Cron job scheduled: Every day at 12:00 PM");

process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  process.exit(0);
});