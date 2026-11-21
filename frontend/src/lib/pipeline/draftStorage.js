const DRAFT_KEY_PREFIX = 'cloudetl:pipeline-draft:';

function storageKey(userId) {
  return `${DRAFT_KEY_PREFIX}${userId ?? 'anon'}`;
}

export function loadPipelineDraft(userId) {
  try {
    const raw = window.sessionStorage?.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePipelineDraft(userId, draft) {
  try {
    window.sessionStorage?.setItem(storageKey(userId), JSON.stringify(draft));
  } catch {
    // Ignore storage quota or private-mode access errors.
  }
}

export function clearPipelineDraft(userId) {
  try {
    window.sessionStorage?.removeItem(storageKey(userId));
  } catch {
    // Ignore storage access errors.
  }
}

export function clearAllPipelineDrafts() {
  try {
    const storage = window.sessionStorage;
    if (!storage) return;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key && key.startsWith(DRAFT_KEY_PREFIX)) storage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors.
  }
}
