/**
 * What the player is told of how the cave is going: how much of it is
 * banked, and what clearing it does.
 */
import { CLEAR_SHARE } from './economy';
import { figure } from './figure';

/** The parts of the economy and the save the line reads. */
export interface Progress {
  cave(): { name: string };
  isLast(): boolean;
  readonly save: { readonly done: boolean; readonly open: boolean; readonly toll: number };
  /** What is still owed of the cave's toll. */
  owed(): number;
  /** The cave's toll in all: nought for the last. */
  tollDue(): number;
}

/** What the note says when the cave is cleared and the way out comes down. */
export const EXIT_OPEN_NOTE = 'the way out is open';
/** How long the note naming the cave the player has come into is shown, in seconds. */
export const ARRIVING_FOR = 6;

/**
 * The note on coming into a cave: its name and what is in it. What was left behind in the one before is the
 * ledger's card, shown under it for as long.
 */
export function arrivalNote(cave: { name: string; blurb: string }): { text: string; seconds: number } {
  return { text: `${cave.name}\n${cave.blurb}`, seconds: ARRIVING_FOR };
}

/** What the note says of what has gone down the drains in the last few moments: a figure of coins. */
export function drainNote(lost: number): string {
  return `${Math.round(lost)} lost down the drain`;
}

/** How long a run of things down a drain is added up for one note, in seconds: after that gap a new one begins. */
export const DRAIN_NOTE_RUN = 2;

/** How far through the cave being cleared the player is, for the counters. */
export function progressText(progress: Progress, banked: number): string {
  if (progress.save.done) return 'the cave is cleared';
  const name = progress.cave().name;
  // while a toll is owed it is the first thing to do in the cave: the share it goes on to is for when it is paid
  if (!progress.save.open && progress.owed() > 0)
    return `${name}: toll ${figure(progress.save.toll)} of ${figure(progress.tollDue())}`;
  const share = `${name}: ${Math.floor(banked * 100)}% banked`;
  if (progress.save.open) return `${share} · the way out is open`;
  return `${share} · ${Math.round(CLEAR_SHARE * 100)}% ${progress.isLast() ? 'clears the cave' : 'opens the way out'}`;
}
