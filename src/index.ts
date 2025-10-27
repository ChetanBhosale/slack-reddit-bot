import Snoowrap from "snoowrap";
import dotenv from "dotenv";
import { WebClient } from "@slack/web-api";
import cron from "node-cron";
import express from "express";
import mongoose from "mongoose";

dotenv.config();

const app = express();

const redditPostSchema = new mongoose.Schema({
  postId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  subreddit: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    required: true,
  },
  sentToSlack: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const RedditPost = mongoose.model("RedditPost", redditPostSchema);

const reddit = new Snoowrap({
  userAgent: "linkrunner-reddit-bot/1.0.0 by u/your_reddit_username",
  clientId: process.env.REDDIT_CLIENT_ID!,
  clientSecret: process.env.REDDIT_CLIENT_SECRET!,
  username: process.env.REDDIT_USERNAME!,
  password: process.env.REDDIT_PASSWORD!,
});

const slackClient = new WebClient(process.env.SLACK_TOKEN);
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;

const SUBREDDITS = [
  "adops",
  "advertising",
  "analytics",
  "androiddev",
  "AppBusiness",
  "AppHookup",
  "AppIdeas",
  "AppleSearchAds",
  "appmarketing",
  "AskMarketing",
  "ASO",
  "bigseo",
  "developersIndia",
  "DigitalMarketing",
  "digitalnomad",
  "Entrepreneur",
  "EntrepreneurRideAlong",
  "FacebookAds",
  "FacebookMarketing",
  "SKAdNetwork",
  "appinstalltracking",
  "install",
  "uninstall",
  "googleads",
  "GrowthHacking",
  "IMadeThis",
  "indianstartups",
  "indiehackers",
  "iOSMarketing",
  "iOSProgramming",
  "learnprogramming",
  "marketing",
  "marketing_digital",
  "MMPCommunity",
  "mobileapps",
  "mobiledev",
  "mobilegamemarketing",
  "mobilemarketing",
  "PPC",
  "reactnative",
  "SaaS",
  "SideProject",
  "smallbusiness",
  "socialmedia",
  "startup",
  "startups",
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
  "ads tracking",
  "install tracking",
  "track uninstall",
];

const POST_LIMIT = 40;
const DELAY_BETWEEN_SUBREDDITS = 600000;

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URL!);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
}

function containsKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPostAlreadySent(postId: string): Promise<boolean> {
  const existingPost = await RedditPost.findOne({ postId });
  return existingPost !== null;
}

async function savePostToDatabase(postData: {
  postId: string;
  subreddit: string;
  title: string;
  url: string;
}) {
  try {
    await RedditPost.create({
      ...postData,
      sentToSlack: true,
    });
  } catch (error) {
    if ((error as any).code === 11000) {
      console.log(`Post ${postData.postId} already exists in database`);
    } else {
      console.error("Error saving post to database:", error);
    }
  }
}

async function sendToSlack(
  posts: { title: string; url: string; subreddit: string; postId: string }[]
) {
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

  for (const post of posts) {
    await savePostToDatabase({
      postId: post.postId,
      subreddit: post.subreddit,
      title: post.title,
      url: post.url,
    });
  }
}

async function fetchPosts() {
  const startTime = new Date().toLocaleString();
  console.log(`\nStarting fetch at ${startTime}`);

  for (let i = 0; i < SUBREDDITS.length; i++) {
    const sub = SUBREDDITS[i]!;
    console.log(`\n[${i + 1}/${SUBREDDITS.length}] Fetching r/${sub}...`);

    const subredditPosts: {
      title: string;
      url: string;
      subreddit: string;
      postId: string;
    }[] = [];

    try {
      const posts = await reddit.getSubreddit(sub).getNew({ limit: POST_LIMIT });
      console.log(`Fetched ${posts.length} posts from r/${sub}`);

      for (const post of posts) {
        const alreadySent = await isPostAlreadySent(post.id);

        if (
          !alreadySent &&
          containsKeyword(post.title + " " + post.selftext)
        ) {
          subredditPosts.push({
            postId: post.id,
            title: post.title,
            url: `https://reddit.com${post.permalink}`,
            subreddit: sub,
          });
        }
      }

      if (subredditPosts.length > 0) {
        console.log(`  > Found ${subredditPosts.length} relevant post(s)`);
        console.log(`\nPosts from r/${sub}:\n`);
        subredditPosts.forEach((p) =>
          console.log(`[${p.subreddit}] ${p.title}\n  ${p.url}\n`)
        );

        try {
          await sendToSlack(subredditPosts);
        } catch (error) {
          console.error("Failed to send to Slack:", error);
        }
      } else {
        console.log(`  > No relevant posts found`);
      }
    } catch (error) {
      console.error(`ERROR fetching r/${sub}:`, error);
    }

    if (i < SUBREDDITS.length - 1) {
      console.log(`Waiting 10 minutes before next subreddit...`);
      await delay(DELAY_BETWEEN_SUBREDDITS);
    }
  }

  console.log(`\nFetch completed at ${new Date().toLocaleString()}`);
}

async function startBot() {
  await connectDB();

  console.log("Reddit Bot starting...");

  cron.schedule("0 14 * * *", () => {
    console.log("\nCron job triggered");
    fetchPosts().catch(console.error);
  });

  console.log("Cron job scheduled: Every day at 2:00 PM");
}

startBot().catch(console.error);

process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await mongoose.disconnect();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({ status: "Reddit Bot is running", nextRun: "2:00 PM daily" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
