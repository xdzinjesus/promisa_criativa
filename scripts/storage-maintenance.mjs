import { maintainStorage } from '../lib/storage-maintenance.js';
const apply = process.argv.includes('--apply');
console.log(JSON.stringify(await maintainStorage({ apply }), null, 2));
