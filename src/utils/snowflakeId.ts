/**
 * Utilities for working with Twitter Snowflake IDs
 * 
 * Twitter Snowflake IDs encode timestamp information:
 * - First 41 bits: milliseconds since Twitter epoch (Nov 04 2010 01:42:54 UTC)
 * - Right-shifting by 22 bits extracts the timestamp portion
 */

const TWITTER_EPOCH = 1288834974657n; // Nov 04 2010 01:42:54 UTC in milliseconds

/**
 * Extract creation timestamp from a Twitter snowflake ID
 * @param snowflakeId - The Twitter snowflake ID as a string
 * @returns Date object representing when the tweet was created
 * @throws Error if the snowflake ID is invalid
 */
export function snowflakeToDate(snowflakeId: string): Date {
  try {
    // Extract timestamp using BigInt for precision with large numbers
    const timestamp = (BigInt(snowflakeId) >> 22n) + TWITTER_EPOCH;
    return new Date(Number(timestamp));
  } catch {
    throw new Error(`Invalid snowflake ID: ${snowflakeId}`);
  }
}

/**
 * Safely extract creation timestamp from a Twitter snowflake ID
 * Returns a fallback date if extraction fails
 * @param snowflakeId - The Twitter snowflake ID as a string
 * @param fallback - Date to return if extraction fails (defaults to current time)
 * @returns Date object representing when the tweet was created, or fallback
 */
export function snowflakeToDateSafe(snowflakeId: string, fallback?: Date): Date {
  try {
    return snowflakeToDate(snowflakeId);
  } catch {
    return fallback || new Date();
  }
}
