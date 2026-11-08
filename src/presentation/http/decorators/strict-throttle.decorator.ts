import { SetMetadata } from '@nestjs/common';

export const STRICT_THROTTLE_KEY = 'strictThrottle';

/** Applies the stricter per-IP rate limit (AUTH_THROTTLE_LIMIT) to a route. */
export const StrictThrottle = (): MethodDecorator => SetMetadata(STRICT_THROTTLE_KEY, true);
