import { createShareStore } from '../lib/share-store.js';
import { createDemoHandler } from '../lib/demo-site.js';
import { cached, readSite } from '../lib/site-cache.js';

const shares = createShareStore();
const findShare = cached(20_000, 30_000, () => shares.all());

export default createDemoHandler({
  findShare: async token => process.env.BLOB_READ_WRITE_TOKEN ? (await findShare()).find(item => item.token === token) || null : null,
  readSite
});
