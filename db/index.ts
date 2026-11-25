import { getDatabase } from '@netlify/database';
import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from './schema.ts';

const connect = () => drizzle({ schema, client: getDatabase() });
let db: ReturnType<typeof connect> | undefined;

export const getDb = () => db ??= connect();
