/**
 * Fixed safety ceiling for the unpaginated listings (`GET /users`, `GET /categories`). It only
 * bounds the response size; real pagination comes later if it is ever needed.
 */
export const MAX_LIST_RESULTS = 500;
