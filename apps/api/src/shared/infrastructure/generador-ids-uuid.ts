import { randomUUID } from 'node:crypto';
import type { GeneradorIds } from '../application/puertos';

export class GeneradorIdsUuid implements GeneradorIds {
  nuevo(): string {
    return randomUUID();
  }
}
