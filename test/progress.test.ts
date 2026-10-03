import { describe, expect, it } from 'vitest';
import { CLEAR_SHARE, tollOf } from '../src/economy';
import { ARRIVING_FOR, EXIT_OPEN_NOTE, arrivalNote, progressText, type Progress } from '../src/progress';
import { RUN } from './helpers';

/** What the economy says of where the player is: the cave `n` of the run, its way out open or not, the game done or not. */
const at = (n: number, open: boolean, done = false, toll = tollOf(RUN[n])): Progress => ({
  cave: () => RUN[n],
  isLast: () => n === RUN.length - 1,
  save: { open, done, toll },
  owed: () => tollOf(RUN[n]) - toll,
  tollDue: () => tollOf(RUN[n]),
});

describe('the progress line', () => {
  it('says how far through the cave the player is, and what clearing it does', () => {
    expect(progressText(at(0, false), 0.456)).toBe(
      `${RUN[0].name}: 45% banked · ${CLEAR_SHARE * 100}% opens the way out`,
    );
    expect(progressText(at(1, false), 0.2)).toBe('South Gallery: 20% banked · 90% opens the way out');
  });

  it('says how much of the toll is paid while one is owed, with a comma at the thousands', () => {
    expect(progressText(at(0, false, false, 640), 0.2)).toBe('The Hollow: toll 640 of 1,000');
    expect(progressText(at(0, false, false, 0), 0)).toBe('The Hollow: toll 0 of 1,000');
    expect(progressText(at(2, false, false, 1234), 0.3)).toBe('East Gallery: toll 1,234 of 1,500');
  });

  it('goes back to the share once the way out is open, whether the toll was paid or not', () => {
    expect(progressText(at(0, true, false, 1000), 0.7)).toBe('The Hollow: 70% banked · the way out is open');
    expect(progressText(at(0, true, false, 100), 0.95)).toBe('The Hollow: 95% banked · the way out is open');
  });

  it('says so when the way out is open', () => {
    expect(progressText(at(1, true), 0.95)).toBe('South Gallery: 95% banked · the way out is open');
  });

  it('says the cave clears the game in the last, and that it is cleared when it is', () => {
    expect(progressText(at(RUN.length - 1, false), 0.2)).toContain('clears the cave');
    expect(progressText(at(RUN.length - 1, false, true), 1)).toBe('the cave is cleared');
  });
});

describe('the words on the way out and on arriving', () => {
  it('says the way out is open', () => {
    expect(EXIT_OPEN_NOTE).toBe('the way out is open');
  });

  it('names the cave and says what is in it, and how long the note is shown', () => {
    const note = arrivalNote(RUN[1], 0);
    expect(note.text).toBe('South Gallery\nrubies and emeralds');
    expect(note.seconds).toBe(ARRIVING_FOR);
  });

  it('says what was left behind in the cave before, when anything was', () => {
    expect(arrivalNote(RUN[2], 1234).text).toBe('East Gallery\nrubies and sapphires\n1234 left behind');
    // nothing left behind is not worth a line
    expect(arrivalNote(RUN[2], 0).text).not.toContain('left behind');
    // a figure with coins' worth, not parts of one
    expect(arrivalNote(RUN[2], 99.6).text).toContain('100 left behind');
  });
});
