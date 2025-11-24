import 'dotenv/config';
import { runMetadataBackfill } from '../src/services/metadataBackfill';

runMetadataBackfill().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
