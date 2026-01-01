import dotenv from 'dotenv';

dotenv.config();

type RequiredEnv = 'DATABASE_URL';

function requireEnv(key: RequiredEnv): string {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Environment variable ${key} is required`);
  }

  return value;
}

export const env = {
  DATABASE_URL: requireEnv('DATABASE_URL'),
};
