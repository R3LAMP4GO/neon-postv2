import Database from 'better-sqlite3';

export interface DailyLog {
  id: number;
  date: string;
  content: string;
  updated_at: string;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get a daily log by date (defaults to today)
 */
export function getDailyLog(db: Database.Database, date?: string): DailyLog | null {
  const targetDate = date || getTodayDate();
  const row = db
    .prepare(
      `
      SELECT id, date, content, updated_at
      FROM daily_logs
      WHERE date = ?
    `
    )
    .get(targetDate) as DailyLog | undefined;

  return row || null;
}

/**
 * Append an entry to today's daily log
 * Creates the log if it doesn't exist
 */
export function appendToDailyLog(db: Database.Database, entry: string): DailyLog {
  const today = getTodayDate();
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const formattedEntry = `[${timestamp}] ${entry}`;

  const existing = getDailyLog(db, today);

  if (existing) {
    // Append to existing log
    const newContent = existing.content + '\n' + formattedEntry;
    db.prepare(
      `
        UPDATE daily_logs
        SET content = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))
        WHERE date = ?
      `
    ).run(newContent, today);
  } else {
    // Create new log for today
    db.prepare(
      `
        INSERT INTO daily_logs (date, content, updated_at)
        VALUES (?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')))
      `
    ).run(today, formattedEntry);
  }

  return getDailyLog(db, today)!;
}

/**
 * Get daily logs from the last N calendar days
 */
export function getDailyLogsSince(db: Database.Database, days: number = 3): DailyLog[] {
  return db
    .prepare(
      `
      SELECT id, date, content, updated_at
      FROM daily_logs
      WHERE date >= date('now', ?)
      ORDER BY date DESC
    `
    )
    .all(`-${days} days`) as DailyLog[];
}

/**
 * Delete a daily log by ID
 */
export function deleteDailyLog(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM daily_logs WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get daily logs as formatted context string for the agent
 */
export function getDailyLogsContext(db: Database.Database, days: number = 3): string {
  const logs = getDailyLogsSince(db, days);
  if (logs.length === 0) {
    return '';
  }

  const lines: string[] = ['## Recent Daily Logs'];
  for (const log of logs.reverse()) {
    // Show oldest first
    const dateLabel = log.date === getTodayDate() ? 'Today' : log.date;
    lines.push(`\n### ${dateLabel}`);
    lines.push(log.content);
  }

  return lines.join('\n');
}
