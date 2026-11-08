import { SetMetadata } from '@nestjs/common';

export const STRICT_THROTTLE_KEY = 'strictThrottle';

/** Applies the stricter per-IP rate limit (AUTH_THROTTLE_LIMIT) to a route. */
export const StrictThrottle = (): MethodDecorator => SetMetadata(STRICT_THROTTLE_KEY, true);

export const LOGIN_EMAIL_THROTTLE_KEY = 'loginEmailThrottle';

/** Also limits the route per IP + normalized email from the body (LOGIN_EMAIL_THROTTLE_LIMIT). */
export const LoginEmailThrottle = (): MethodDecorator => SetMetadata(LOGIN_EMAIL_THROTTLE_KEY, true);
