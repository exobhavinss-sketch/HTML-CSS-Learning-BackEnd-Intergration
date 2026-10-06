/**
 * User Data Persistence Service
 * Manages Supabase PostgreSQL persistence for authenticated learning progress:
 * - Practice Arena progress (solved status, code solutions, roll number, name)
 * - Workbench progress (custom HTML edits, CSS line toggles, dropdown values)
 * - User Preferences (dark/light theme, topic sidebar visibility, last visited topic/practice)
 * - Debounced auto-saving, offline resilience queue, and login state restoration.
 */

import { supabase } from './supabase.js';

// Local storage keys for temporary caching and offline resilience
const PENDING_QUEUE_KEY = 'tagfinder_pending_sync_v1';
const USER_CACHE_KEY = 'tagfinder_user_cache_v1';
const LOCAL_PRACTICE_KEY = 'tagfinder-practice-v1';

/**
 * Controller for the persistent Save Status badge in the top navigation bar.
 */
class SaveStatusController {
  constructor() {
    this.container = null;
    this.status = 'hidden'; // 'hidden' | 'saved' | 'saving' | 'syncing' | 'offline' | 'error'
    this.hideTimeout = null;
  }

  init(selector = '#save-status-root') {
    this.container = document.querySelector(selector);
    this.render();
  }

  setStatus(status, message = null) {
    this.status = status;
    this.customMessage = message;
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    this.render();
  }

  render() {
    if (!this.container) return;

    if (this.status === 'hidden') {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'inline-flex';

    let dotClass = 'dot-saved';
    let text = 'Saved';
    let ariaLabel = 'All changes saved to your account';

    switch (this.status) {
      case 'saving':
        dotClass = 'dot-saving';
        text = 'Saving...';
        ariaLabel = 'Saving changes to your account';
        break;
      case 'syncing':
        dotClass = 'dot-syncing';
        text = 'Syncing...';
        ariaLabel = 'Synchronizing offline work to cloud';
        break;
      case 'offline':
        dotClass = 'dot-offline';
        text = 'Offline (cached)';
        ariaLabel = 'Offline: changes cached locally and will sync when connected';
        break;
      case 'error':
        dotClass = 'dot-error';
        text = 'Sync retry pending';
        ariaLabel = 'Unable to reach cloud; changes queued for retry';
        break;
      case 'saved':
      default:
        dotClass = 'dot-saved';
        text = 'Saved';
        ariaLabel = 'All progress saved to your account';
        break;
    }

    if (this.customMessage) {
      text = this.customMessage;
    }

    this.container.innerHTML = `
      <div class="save-status-badge ${this.status}" role="status" aria-label="${ariaLabel}" title="${ariaLabel}">
        <span class="save-status-dot ${dotClass}" aria-hidden="true"></span>
        <span class="save-status-text">${text}</span>
      </div>
    `;
  }
}

class UserDataService {
  constructor() {
    this.currentUser = null;
    this.saveStatus = new SaveStatusController();
    this.debounceTimers = new Map();
    this.pendingCallbacks = new Map();
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.isSyncing = false;

    // In-memory cache for active user
    this.cachedData = {
      profile: null,
      practice: {},
      workbench: {},
      preferences: null
    };

    this.handleOnline = this.handleOnline.bind(this);
    this.handleOffline = this.handleOffline.bind(this);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
  }

  /**
   * Initializes network and lifecycle listeners.
   */
  init() {
    this.saveStatus.init('#save-status-root');

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      window.addEventListener('beforeunload', this.handleBeforeUnload);
      window.addEventListener('themechange', (e) => {
        if (e.detail?.theme && this.currentUser) {
          this.saveUserPreferences({ theme: e.detail.theme }, true);
        }
      });
    }
  }

  handleOnline() {
    this.isOnline = true;
    console.log('[UserDataService] Network connection restored.');
    this.saveStatus.setStatus('syncing', 'Syncing...');
    this.syncPendingQueue().then(() => {
      this.saveStatus.setStatus('saved', 'Saved');
    });
  }

  handleOffline() {
    this.isOnline = false;
    console.warn('[UserDataService] Network connection lost.');
    this.saveStatus.setStatus('offline');
  }

  handleBeforeUnload() {
    // Flush all pending debounce saves synchronously or via immediate queue
    this.flushAllPending();
  }

  /**
   * Called when Supabase reports a signed-in user.
   * Loads all server data, executes local data migration if needed,
   * and restores full application state.
   * @param {any} user Supabase user object
   */
  async handleUserSignIn(user) {
    if (!user) return;
    this.currentUser = user;
    this.saveStatus.setStatus('saving', 'Loading progress...');

    try {
      // 1. Fetch user data from Supabase
      const serverData = await this.loadAllUserData(user.id);

      // 2. Check for existing local progress to migrate into new or incomplete server account
      await this.checkAndMigrateLocalProgress(user.id, serverData);

      // 3. Re-read data into cache after possible migration
      this.cachedData = serverData;

      // 4. Restore application runtime state in the DOM
      if (typeof window !== 'undefined' && typeof window.restoreUserDataFromService === 'function') {
        window.restoreUserDataFromService(this.cachedData);
      }

      // 5. Sync any offline pending queue items
      if (this.isOnline) {
        await this.syncPendingQueue();
      }

      this.saveStatus.setStatus('saved', 'Saved');
      console.log('[UserDataService] User progress successfully restored from Supabase.');
    } catch (err) {
      console.error('[UserDataService] Error during user sign-in restore:', err);
      this.saveStatus.setStatus('error', 'Sync warning');
    }
  }

  /**
   * Called when user logs out.
   * Flushes pending saves, clears in-memory user cache, and resets UI state.
   * CRITICAL: Never issues any DELETE statements to Supabase!
   */
  async handleUserSignOut() {
    console.log('[UserDataService] Signing out: flushing pending saves without deleting data.');
    await this.flushAllPending();

    this.currentUser = null;
    this.cachedData = {
      profile: null,
      practice: {},
      workbench: {},
      preferences: null
    };

    this.saveStatus.setStatus('hidden');

    // Reset DOM runtime state to clean public defaults
    if (typeof window !== 'undefined' && typeof window.resetToLoggedOutState === 'function') {
      window.resetToLoggedOutState();
    }
  }

  /**
   * Loads all data for the authenticated user from Supabase PostgreSQL.
   * @param {string} userId
   * @returns {Promise<{ profile: any, practice: Record<string, any>, workbench: Record<string, any>, preferences: any }>}
   */
  async loadAllUserData(userId) {
    if (!userId) return { profile: null, practice: {}, workbench: {}, preferences: null };

    try {
      const [profileRes, practiceRes, workbenchRes, prefsRes] = await Promise.allSettled([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('practice_progress').select('*').eq('user_id', userId),
        supabase.from('workbench_progress').select('*').eq('user_id', userId),
        supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle()
      ]);

      const profile = profileRes.status === 'fulfilled' && profileRes.value.data ? profileRes.value.data : null;

      const practice = {};
      if (practiceRes.status === 'fulfilled' && Array.isArray(practiceRes.value.data)) {
        practiceRes.value.data.forEach((p) => {
          practice[p.challenge_id] = {
            challenge_id: p.challenge_id,
            set_key: p.set_key,
            solved: Boolean(p.solved),
            code: p.code || '',
            updated_at: p.updated_at
          };
        });
      }

      const workbench = {};
      if (workbenchRes.status === 'fulfilled' && Array.isArray(workbenchRes.value.data)) {
        workbenchRes.value.data.forEach((w) => {
          workbench[w.topic_id] = {
            topic_id: w.topic_id,
            html_content: w.html_content || null,
            css_toggles: Array.isArray(w.css_toggles) ? w.css_toggles : [],
            css_values: w.css_values && typeof w.css_values === 'object' ? w.css_values : {},
            updated_at: w.updated_at
          };
        });
      }

      const preferences = prefsRes.status === 'fulfilled' && prefsRes.value.data ? prefsRes.value.data : null;

      return { profile, practice, workbench, preferences };
    } catch (err) {
      console.error('[UserDataService] Exception querying Supabase data:', err);
      return { profile: null, practice: {}, workbench: {}, preferences: null };
    }
  }

  /**
   * Migrates existing local practice progress (from localStorage) to Supabase
   * if the user has local data that does not exist in their Supabase account.
   * @param {string} userId
   * @param {any} serverData
   */
  async checkAndMigrateLocalProgress(userId, serverData) {
    if (!userId) return;

    try {
      const rawLocal = localStorage.getItem(LOCAL_PRACTICE_KEY);
      if (!rawLocal) return;

      const localPS = JSON.parse(rawLocal);
      if (!localPS || typeof localPS !== 'object') return;

      const hasLocalSolved = localPS.solved && Object.keys(localPS.solved).length > 0;
      const hasLocalWork = localPS.work && Object.keys(localPS.work).length > 0;
      const hasLocalName = Boolean(localPS.name && localPS.name.trim());
      const hasLocalRoll = Boolean(localPS.roll && localPS.roll.trim());

      if (!hasLocalSolved && !hasLocalWork && !hasLocalName && !hasLocalRoll) return;

      console.log('[UserDataService] Found local progress in browser. Checking if migration to account is required...');

      // Update profile if missing on server
      if ((hasLocalName || hasLocalRoll) && (!serverData.profile || !serverData.profile.roll_number)) {
        const fullName = serverData.profile?.full_name || localPS.name || '';
        const rollNumber = serverData.profile?.roll_number || localPS.roll || '';
        await this.saveProfile({ fullName, rollNumber }, true);
      }

      // Migrate practice items that don't yet exist on the server
      const migrationBatch = [];
      const localSolved = localPS.solved || {};
      const localWork = localPS.work || {};

      const allChallengeIds = new Set([...Object.keys(localSolved), ...Object.keys(localWork)]);

      for (const chId of allChallengeIds) {
        const isSolved = Boolean(localSolved[chId]);
        const code = localWork[chId] || '';

        // If server already has a record with solved=true or code, don't overwrite newer server work
        const existingServer = serverData.practice[chId];
        if (!existingServer || (!existingServer.solved && isSolved)) {
          // Determine set key from id prefix (e.g. p-htm-1 -> HTM, p-css-1 -> CSS)
          const setKey = this.extractSetKey(chId);
          migrationBatch.push({
            user_id: userId,
            challenge_id: chId,
            set_key: setKey,
            solved: isSolved,
            code: code,
            updated_at: new Date().toISOString()
          });

          // Update in-memory serverData so it reflects immediately
          serverData.practice[chId] = {
            challenge_id: chId,
            set_key: setKey,
            solved: isSolved,
            code: code
          };
        }
      }

      if (migrationBatch.length > 0) {
        console.log(`[UserDataService] Migrating ${migrationBatch.length} local practice records to Supabase...`);
        const { error } = await supabase.from('practice_progress').upsert(migrationBatch, {
          onConflict: 'user_id,challenge_id'
        });

        if (error) {
          console.warn('[UserDataService] Warning migrating local progress:', error.message);
        } else {
          console.log('[UserDataService] Local progress successfully migrated to Supabase account.');
        }
      }
    } catch (e) {
      console.warn('[UserDataService] Error checking local progress migration:', e);
    }
  }

  extractSetKey(challengeId) {
    const id = String(challengeId).toUpperCase();
    if (id.includes('HTM')) return 'HTM';
    if (id.includes('CSS')) return 'CSS';
    if (id.includes('FLX')) return 'FLX';
    if (id.includes('GRD')) return 'GRD';
    if (id.includes('POS')) return 'POS';
    return 'HTM';
  }

  /**
   * Saves or updates a practice challenge's solved status and user code.
   * Debounced for code typing; immediate for solving.
   * @param {{ challengeId: string, setKey?: string, solved?: boolean, code?: string }} payload
   * @param {boolean} [immediate=false]
   */
  async savePracticeChallenge({ challengeId, setKey, solved, code }, immediate = false) {
    if (!this.currentUser) return;

    const resolvedSetKey = setKey || this.extractSetKey(challengeId);
    const existing = this.cachedData.practice[challengeId] || {};

    const updated = {
      challenge_id: challengeId,
      set_key: resolvedSetKey,
      solved: solved !== undefined ? Boolean(solved) : Boolean(existing.solved),
      code: code !== undefined ? code : (existing.code || '')
    };

    this.cachedData.practice[challengeId] = updated;

    const runSave = async () => {
      this.saveStatus.setStatus('saving');
      const record = {
        user_id: this.currentUser.id,
        challenge_id: updated.challenge_id,
        set_key: updated.set_key,
        solved: updated.solved,
        code: updated.code,
        updated_at: new Date().toISOString()
      };

      if (!this.isOnline) {
        this.queueOfflineItem('practice_progress', record);
        this.saveStatus.setStatus('offline');
        return;
      }

      try {
        const { error } = await supabase.from('practice_progress').upsert(record, {
          onConflict: 'user_id,challenge_id'
        });

        if (error) {
          console.warn('[UserDataService] Error saving practice progress:', error.message);
          this.queueOfflineItem('practice_progress', record);
          this.saveStatus.setStatus('error');
        } else {
          this.saveStatus.setStatus('saved');
        }
      } catch (err) {
        console.error('[UserDataService] Network exception saving practice:', err);
        this.queueOfflineItem('practice_progress', record);
        this.saveStatus.setStatus('offline');
      }
    };

    if (immediate) {
      this.clearDebounce(`practice_${challengeId}`);
      await runSave();
    } else {
      this.debounce(`practice_${challengeId}`, runSave, 800);
    }
  }

  /**
   * Saves or updates workbench topic HTML, CSS line toggles, and dropdown values.
   * Debounced for HTML editor typing; immediate for toggles.
   * @param {{ topicId: string, html?: string, cssToggles?: boolean[], cssValues?: Record<string, string> }} payload
   * @param {boolean} [immediate=false]
   */
  async saveWorkbenchTopic({ topicId, html, cssToggles, cssValues }, immediate = false) {
    if (!this.currentUser) return;

    const existing = this.cachedData.workbench[topicId] || {};

    const updated = {
      topic_id: topicId,
      html_content: html !== undefined ? html : existing.html_content,
      css_toggles: cssToggles !== undefined ? cssToggles : (existing.css_toggles || []),
      css_values: cssValues !== undefined ? cssValues : (existing.css_values || {})
    };

    this.cachedData.workbench[topicId] = updated;

    const runSave = async () => {
      this.saveStatus.setStatus('saving');
      const record = {
        user_id: this.currentUser.id,
        topic_id: updated.topic_id,
        html_content: updated.html_content,
        css_toggles: updated.css_toggles,
        css_values: updated.css_values,
        updated_at: new Date().toISOString()
      };

      if (!this.isOnline) {
        this.queueOfflineItem('workbench_progress', record);
        this.saveStatus.setStatus('offline');
        return;
      }

      try {
        const { error } = await supabase.from('workbench_progress').upsert(record, {
          onConflict: 'user_id,topic_id'
        });

        if (error) {
          console.warn('[UserDataService] Error saving workbench progress:', error.message);
          this.queueOfflineItem('workbench_progress', record);
          this.saveStatus.setStatus('error');
        } else {
          this.saveStatus.setStatus('saved');
        }
      } catch (err) {
        console.error('[UserDataService] Network exception saving workbench:', err);
        this.queueOfflineItem('workbench_progress', record);
        this.saveStatus.setStatus('offline');
      }
    };

    if (immediate) {
      this.clearDebounce(`workbench_${topicId}`);
      await runSave();
    } else {
      this.debounce(`workbench_${topicId}`, runSave, 800);
    }
  }

  /**
   * Saves or updates profile information (full_name, roll_number).
   * @param {{ fullName?: string, rollNumber?: string }} payload
   * @param {boolean} [immediate=false]
   */
  async saveProfile({ fullName, rollNumber }, immediate = false) {
    if (!this.currentUser) return;

    const existing = this.cachedData.profile || {};
    const updated = {
      full_name: fullName !== undefined ? fullName : (existing.full_name || ''),
      roll_number: rollNumber !== undefined ? rollNumber : (existing.roll_number || '')
    };

    this.cachedData.profile = { ...(this.cachedData.profile || {}), ...updated };

    const runSave = async () => {
      this.saveStatus.setStatus('saving');
      const record = {
        id: this.currentUser.id,
        full_name: updated.full_name,
        roll_number: updated.roll_number,
        updated_at: new Date().toISOString()
      };

      if (!this.isOnline) {
        this.queueOfflineItem('profiles', record);
        this.saveStatus.setStatus('offline');
        return;
      }

      try {
        const { error } = await supabase.from('profiles').upsert(record, {
          onConflict: 'id'
        });

        if (error) {
          console.warn('[UserDataService] Error saving profile:', error.message);
          this.queueOfflineItem('profiles', record);
          this.saveStatus.setStatus('error');
        } else {
          this.saveStatus.setStatus('saved');
        }
      } catch (err) {
        console.error('[UserDataService] Network exception saving profile:', err);
        this.queueOfflineItem('profiles', record);
        this.saveStatus.setStatus('offline');
      }
    };

    if (immediate) {
      this.clearDebounce('profile_save');
      await runSave();
    } else {
      this.debounce('profile_save', runSave, 600);
    }
  }

  /**
   * Saves or updates user preferences (theme, hide_topics, last_topic_id, pset, pidx).
   * @param {Record<string, any>} prefs
   * @param {boolean} [immediate=true]
   */
  async saveUserPreferences(prefs, immediate = true) {
    if (!this.currentUser) return;

    this.cachedData.preferences = {
      ...(this.cachedData.preferences || {}),
      ...prefs
    };

    const runSave = async () => {
      this.saveStatus.setStatus('saving');
      const current = this.cachedData.preferences;

      const record = {
        user_id: this.currentUser.id,
        theme: current.theme || 'dark',
        hide_topics: Boolean(current.hide_topics),
        last_topic_id: current.last_topic_id || 'navbar',
        last_practice_set: current.last_practice_set || 'HTM',
        last_practice_idx: Number.isInteger(current.last_practice_idx) ? current.last_practice_idx : 0,
        device_view: current.device_view || 'laptop',
        example_view: current.example_view || 'boxes',
        updated_at: new Date().toISOString()
      };

      if (!this.isOnline) {
        this.queueOfflineItem('user_preferences', record);
        this.saveStatus.setStatus('offline');
        return;
      }

      try {
        const { error } = await supabase.from('user_preferences').upsert(record, {
          onConflict: 'user_id'
        });

        if (error) {
          console.warn('[UserDataService] Error saving preferences:', error.message);
          this.queueOfflineItem('user_preferences', record);
          this.saveStatus.setStatus('error');
        } else {
          this.saveStatus.setStatus('saved');
        }
      } catch (err) {
        console.error('[UserDataService] Network exception saving preferences:', err);
        this.queueOfflineItem('user_preferences', record);
        this.saveStatus.setStatus('offline');
      }
    };

    if (immediate) {
      this.clearDebounce('preferences_save');
      await runSave();
    } else {
      this.debounce('preferences_save', runSave, 600);
    }
  }

  /**
   * Debounce helper that associates a key with a delayed execution callback.
   */
  debounce(key, fn, delay = 800) {
    this.saveStatus.setStatus('saving');
    this.clearDebounce(key);
    this.pendingCallbacks.set(key, fn);

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(key);
      this.pendingCallbacks.delete(key);
      try {
        await fn();
      } catch (e) {
        console.error(`[UserDataService] Debounced execution error for ${key}:`, e);
      }
    }, delay);

    this.debounceTimers.set(key, timer);
  }

  clearDebounce(key) {
    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key));
      this.debounceTimers.delete(key);
    }
    this.pendingCallbacks.delete(key);
  }

  /**
   * Immediately executes all currently queued debounce callbacks.
   */
  async flushAllPending() {
    if (this.pendingCallbacks.size === 0) return;

    console.log(`[UserDataService] Flushing ${this.pendingCallbacks.size} pending debounced saves...`);
    const callbacks = Array.from(this.pendingCallbacks.values());

    // Clear timers and map
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingCallbacks.clear();

    for (const fn of callbacks) {
      try {
        await fn();
      } catch (e) {
        console.warn('[UserDataService] Error flushing pending callback:', e);
      }
    }
  }

  /**
   * Stores a failed or offline change in the local pending sync queue.
   */
  queueOfflineItem(table, record) {
    try {
      const raw = localStorage.getItem(PENDING_QUEUE_KEY);
      const queue = raw ? JSON.parse(raw) : [];

      // Remove existing item for same key if present to keep latest
      const filtered = queue.filter(item => {
        if (item.table !== table) return true;
        if (table === 'practice_progress') {
          return !(item.record.user_id === record.user_id && item.record.challenge_id === record.challenge_id);
        }
        if (table === 'workbench_progress') {
          return !(item.record.user_id === record.user_id && item.record.topic_id === record.topic_id);
        }
        if (table === 'profiles') {
          return item.record.id !== record.id;
        }
        if (table === 'user_preferences') {
          return item.record.user_id !== record.user_id;
        }
        return true;
      });

      filtered.push({
        table,
        record,
        timestamp: Date.now()
      });

      localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(filtered));
      console.log(`[UserDataService] Change queued offline for ${table}. Pending count: ${filtered.length}`);
    } catch (e) {
      console.warn('[UserDataService] Could not write to offline pending queue:', e);
    }
  }

  /**
   * Synchronizes queued offline items to Supabase PostgreSQL when back online.
   */
  async syncPendingQueue() {
    if (!this.currentUser || this.isSyncing) return;
    this.isSyncing = true;

    try {
      const raw = localStorage.getItem(PENDING_QUEUE_KEY);
      if (!raw) {
        this.isSyncing = false;
        return;
      }

      const queue = JSON.parse(raw);
      if (!Array.isArray(queue) || queue.length === 0) {
        this.isSyncing = false;
        return;
      }

      console.log(`[UserDataService] Attempting to sync ${queue.length} pending offline items...`);
      const remaining = [];

      for (const item of queue) {
        try {
          let conflictKey = 'user_id';
          if (item.table === 'practice_progress') conflictKey = 'user_id,challenge_id';
          else if (item.table === 'workbench_progress') conflictKey = 'user_id,topic_id';
          else if (item.table === 'profiles') conflictKey = 'id';
          else if (item.table === 'user_preferences') conflictKey = 'user_id';

          const { error } = await supabase.from(item.table).upsert(item.record, {
            onConflict: conflictKey
          });

          if (error) {
            console.warn(`[UserDataService] Error syncing queued item for ${item.table}:`, error.message);
            remaining.push(item);
          }
        } catch (itemErr) {
          remaining.push(item);
        }
      }

      if (remaining.length > 0) {
        localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(remaining));
      } else {
        localStorage.removeItem(PENDING_QUEUE_KEY);
        console.log('[UserDataService] All offline changes successfully synchronized!');
      }
    } catch (err) {
      console.error('[UserDataService] Exception syncing pending queue:', err);
    } finally {
      this.isSyncing = false;
    }
  }
}

export const userDataService = new UserDataService();

if (typeof window !== 'undefined') {
  window.userDataService = userDataService;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => userDataService.init());
  } else {
    userDataService.init();
  }
}
