import type { User } from '$lib/server/db/schema.js';

// See https://kit.svelte.dev/docs/types#app for information about these interfaces.
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      user: User | null;
    }
    interface PageData {
      user:
        | (Pick<User, 'id' | 'email' | 'displayName' | 'role'> & {
            /** T-11.7: drives the verification banner.
             *  True iff `users.email_verified_at IS NOT NULL`. */
            emailVerified: boolean;
          })
        | null;
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
