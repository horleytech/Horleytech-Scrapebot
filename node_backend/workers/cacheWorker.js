import { parentPort } from 'worker_threads';
import { forceBuildGlobalCache } from '../cronTasks.js';

const run = async () => {
  try {
    const total = await forceBuildGlobalCache();
    parentPort?.postMessage({ success: true, total });
  } catch (error) {
    parentPort?.postMessage({ success: false, error: error.message });
    process.exitCode = 1;
  }
};

run();
