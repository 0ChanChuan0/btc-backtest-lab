// 與 worker.js 溝通的 Promise 介面

export function createWorkerClient() {
  const worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let seq = 0;

  worker.onmessage = (e) => {
    const { id, kind } = e.data;
    const job = pending.get(id);
    if (!job) return;
    if (kind === 'progress') { job.onProgress?.(e.data.value); return; }
    pending.delete(id);
    if (kind === 'result') job.resolve(e.data.data);
    else job.reject(new Error(e.data.message));
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'Worker 發生錯誤'));
    pending.clear();
  };

  return {
    request(type, payload, onProgress) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ id, type, payload });
      });
    },
  };
}
