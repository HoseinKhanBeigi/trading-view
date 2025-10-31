import { UTCTimestamp } from "lightweight-charts";

export function toUTCTimestamp(seconds: number): UTCTimestamp {
  return seconds as UTCTimestamp;
}

export function formatLocal(ts: UTCTimestamp): string {
  return new Date((ts as number) * 1000).toLocaleString();
}

export const localTimeFormatter = (ts: UTCTimestamp): string => formatLocal(ts);


