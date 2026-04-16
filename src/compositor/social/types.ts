export interface TweetCardData {
  displayName: string;
  handle: string;
  body: string;
  avatarUrl?: string;
  timestamp?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  verified?: boolean;
}

export interface QuoteCardData {
  quote: string;
  author: string;
  role?: string;
}

export interface CommentCardData {
  displayName: string;
  handle: string;
  body: string;
  avatarUrl?: string;
  platform?: 'twitter' | 'bluesky' | 'linkedin' | 'threads';
}
