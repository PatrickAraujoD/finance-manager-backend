import { IdGenerator } from '../../../src/application/ports/id-generator';

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  next(): string {
    return `id-${++this.counter}`;
  }
}
