import { reconcileQueue } from '../server/pix.mjs';

export default async () => {
  await reconcileQueue();
};

export const config = { schedule: '*/2 * * * *' };
