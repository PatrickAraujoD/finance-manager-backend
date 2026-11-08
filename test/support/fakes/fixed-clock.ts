import { Clock } from '../../../src/application/ports/clock';

export class FixedClock implements Clock {
  constructor(private current: Date = new Date('2026-11-08T12:00:00Z')) {}

  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}
