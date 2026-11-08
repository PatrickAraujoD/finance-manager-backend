import { Role } from '../domain/role';

/** The authenticated caller of a use case. The role comes from the database, not the token. */
export interface Actor {
  id: string;
  role: Role;
}
