/**
 * What the player is told of how the cave is going: how much of it is
 * banked, and what clearing it does.
 */
import { CLEAR_SHARE } from './economy';

/** The parts of the economy and the save the line reads. */
export interface Progress {
  cave(): { name: string };
  isLast(): boolean;
  readonly save: { readonly done: boolean; readonly open: boolean };
}

/** What the note says when the cave is cleared and the way out comes down. */
export const EXIT_OPEN_NOTE = 'the way out is open';
/** How long the note naming the cave the player has come into is shown, in seconds. */
export const ARRIVING_FOR = 6;

/**
 * The note on coming into a cave: its name and what is in it, and, when there was any, the worth of what
 * was left behind in the one before, a figure of coins.
 */
export function arrivalNote(cave: { name: string; blurb: string }, lost: number): { text: string; seconds: number } {
  const behind = Math.round(lost) > 0 ? `\n${Math.round(lost)} left behind` : '';
  return { text: `${cave.name}\n${cave.blurb}${behind}`, seconds: ARRIVING_FOR };
}

/** How far through the cave being cleared the player is, for the counters. */
export function progressText(progress: Progress, banked: number): string {
  if (progress.save.done) return 'the cave is cleared';
  const name = progress.cave().name;
  const share = `${name}: ${Math.floor(banked * 100)}% banked`;
  if (progress.save.open) return `${share} · the way out is open`;
  return `${share} · ${Math.round(CLEAR_SHARE * 100)}% ${progress.isLast() ? 'clears the cave' : 'opens the way out'}`;
}
