/** The editor's feed worker: the shared store worker plus the patch log. */

import { serveStore } from 'gtfs-zone-web-common/gtfs/store/store-worker-core';
import { feedWorkerApi } from '../feed/feed-worker-api';

serveStore(feedWorkerApi);
