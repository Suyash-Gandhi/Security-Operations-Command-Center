import argon2 from "argon2";

/**
 * Password hashing with argon2id (library default parameters).
 * Plaintext passwords never leave this module.
 */
export class PasswordService {
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, { type: argon2.argon2id });
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }
}
