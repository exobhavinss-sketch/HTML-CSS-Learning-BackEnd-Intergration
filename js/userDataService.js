/**
 * User Data Persistence Service
 * Manages Supabase PostgreSQL persistence for authenticated learning progress:
 * - Practice Arena progress (solved status, code solutions, roll number, name)
 * - Workbench progress (custom HTML edits, CSS line toggles, dropdown values)
 * - User Preferences (dark/light theme, topic sidebar visibility, last visited topic/practice)
 * - Debounced auto-saving, user-isolated offline queue, exponential backoff, and login state restoration.
 */

import { supabase } from './supabase.js';

// Local storage key templates
const PENDING_QUEUE_PREFIX = 'pendingSync:';
const LEGACY_PENDING_QUEUE_KEY = 'tagfinder_pending_sync_v1';
const LOCAL_PRACTICE_KEY = 'tagfinder-practice-v1';

/**
 * Controller for the persistent Save Status badge in the top navigation bar.
 */
class SaveStatusController {
  constructor() {
    this.container = null;
    this.status = 'hidden'; // 'hidden' | 'saved' | 'saving' | 'syncing' | 'offline' | 'retry_pending' | 'failed' | 'auth_required'
    this.customMessage = null;
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
    let badgeClass = 'saved';
    let text = 'Saved';
    let ariaLabel = 'All changes saved to your account';

    switch (this.status) {
      case 'saving':
        dotClass = 'dot-saving';
        badgeClass = 'saving';
        text = 'Saving...';
        ariaLabel = 'Saving changes to your account';
        break;

      case 'syncing':
        dotClass = 'dot-syncing';
        badgeClass = 'syncing';
        text = 'Syncing...';
        ariaLabel = 'Synchronizing offline work to cloud';
        break;

      case 'offline':
        dotClass = 'dot-offline';
        badgeClass = 'offline';
        text = 'Offline — will retry';
        ariaLabel = 'Offline: changes cached locally and will sync when connected';
        break;

      case 'retry_pending':
      case 'error':
        dotClass = 'dot-retry-pending';
        badgeClass = 'retry-pending';
        text = 'Sync retry pending';
        ariaLabel = 'Temporary sync issue; retry is queued';
        break;

      case 'failed':
        dotClass = 'dot-error';
        badgeClass = 'error';
        text = 'Unable to save';
        ariaLabel = 'Cloud synchronization encountered an error';
        break;

      case 'auth_required':
        dotClass = 'dot-offline';
        badgeClass = 'auth-required';
        text = 'Local mode';
        ariaLabel = 'Sign in to automatically sync your progress across devices';
        break;

      case 'saved':
      default:
        dotClass = 'dot-saved';
        badgeClass = 'saved';
        text = 'Saved';
        ariaLabel = 'All progress saved to your account';
        break;
    }

    if (this.customMessage) {
      text = this.customMessage;
    }

    this.container.innerHTML = `
      <div class="save-status-badge ${badgeClass}" role="status" aria-label="${ariaLabel}" title="${ariaLabel}">
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
    this.retryTimeoutId = null;

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

    // Clean up legacy un-scoped queue if present
    this.migrateLegacyQueue();
  }

  /**
   * Verifies the active authentication session directly from Supabase Auth.
   * Never trusts unverified client state or manual IDs.
   * @returns {Promise<{ isAuth: boolean, userId: string | null, session: any, error: any }>}
   */
  async verifySession() {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session || !session.user) {
        return { isAuth: false, userId: null, session: null, error: error || 'AUTH_REQUIRED' };
      }
      this.currentUser = session.user;
      return { isAuth: true, userId: session.user.id, session, error: null };
    } catch (err) {
      console.warn('[UserDataService] Exception verifying auth session:', err);
      return { isAuth: false, userId: null, session: null, error: err };
    }
  }

  /**
   * Helper for comprehensive, structured developer error logging.
   * Logs complete error object without exposing sensitive credentials.
   */
  logSyncFailure(table, operation, userId, recordKey, error) {
    const errorDetails = {
      table,
      operation,
      userId: userId || 'unauthenticated',
      recordKey: recordKey || 'unknown',
      error,
      code: error?.code || 'UNKNOWN_CODE',
      message: error?.message || (typeof error === 'string' ? error : 'Unknown error'),
      details: error?.details || null,
      hint: error?.hint || null,
      status: error?.status || error?.statusCode || null
    };

    console.error('[SYNC FAILED]', errorDetails);

    // Provide actionable developer guidance for schema setup if table is missing
    if (error?.code === 'PGRST205') {
      console.warn(
        `[SYNC HINT] Table "public.${table}" does not exist in your Supabase project yet.\n` +
        `To create the required tables, open the Supabase SQL Editor and execute:\n` +
        `supabase/migrations/001_user_data_persistence.sql`
      );
    }
  }

  /**
   * Safe payload logging for development transparency.
   */
  logSyncPayload(table, operation, userId, recordKey, payload) {
    console.debug('[SYNC PAYLOAD]', {
      table,
      operation,
      userId,
      recordKey,
      updated_at: payload?.updated_at
    });
  }

  /**
   * Determines whether an error is transient/retryable (e.g. network/5xx)
   * or permanent/non-retryable (e.g. missing table, RLS denied, 4xx, bad schema).
   * @param {any} error
   * @returns {boolean}
   */
  isRetryableError(error) {
    if (!error) return false;

    // 1. PostgREST / PostgreSQL non-retryable codes must be checked FIRST
    const nonRetryableCodes = [
      'PGRST205', // Missing table in schema cache
      '42P01',    // Undefined table
      '42501',    // RLS permission denied
      '42703',    // Undefined column
      '23505',    // Unique violation
      '23503',    // Foreign key violation
      '23502',    // Not null violation
      '22P02',    // Invalid text representation
      'AUTH_REQUIRED'
    ];

    if (error.code && nonRetryableCodes.includes(String(error.code))) {
      return false;
    }

    // 2. HTTP 4xx errors are client/schema errors; retrying will not help
    const status = error.status || error.statusCode;
    if (status && status >= 400 && status < 500) {
      return false;
    }

    // 3. Network / offline detection
    if (!this.isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return true;
    }

    // 4. Network / timeout / 5xx errors are retryable
    const msg = (error.message || String(error)).toLowerCase();
    if (
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('failed to fetch') ||
      msg.includes('timeout') ||
      msg.includes('abort') ||
      (status && status >= 500)
    ) {
      return true;
    }

    return false;
  }

  handleOnline() {
    this.isOnline = true;
    console.log('[UserDataService] Network connection restored.');
    this.saveStatus.setStatus('syncing', 'Syncing...');
    this.syncPendingQueue();
  }

  handleOffline() {
    this.isOnline = false;
    console.warn('[UserDataService] Network connection lost.');
    this.saveStatus.setStatus('offline');
  }

  handleBeforeUnload() {
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

      // 5. Sync any offline pending queue items for this user
      if (this.isOnline) {
        await this.syncPendingQueue();
      } else {
        const queue = this.getUserQueue(user.id);
        if (queue.length > 0) {
          this.saveStatus.setStatus('offline');
        } else {
          this.saveStatus.setStatus('saved');
        }
      }

      console.log('[UserDataService] User progress successfully restored from Supabase.');
    } catch (err) {
      console.error('[UserDataService] Error during user sign-in restore:', err);
      this.updateStatusAfterOperation();
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

    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }

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

        const existingServer = serverData.practice[chId];
        if (!existingServer || (!existingServer.solved && isSolved)) {
          const setKey = this.extractSetKey(chId);
          migrationBatch.push({
            user_id: userId,
            challenge_id: chId,
            set_key: setKey,
            solved: isSolved,
            code: code,
            updated_at: new Date().toISOString()
          });

          serverData.practice[chId] = {
            challenge_id: chId,
            set_key: setKey,
            solved: isSolved,
            code: code
          };
        }
      }

      if (migrationBatch.length > 0) {
        const { error } = await supabase.from('practice_progress').upsert(migrationBatch, {
          onConflict: 'user_id,challenge_id'
        });

        if (error) {
          this.logSyncFailure('practice_progress', 'migration_upsert', userId, 'batch', error);
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
      // 1. Verify authentication session directly
      const auth = await this.verifySession();
      if (!auth.isAuth) {
        this.saveStatus.setStatus('auth_required');
        return;
      }

      const userId = auth.userId;
      const record = {
        user_id: userId,
        challenge_id: updated.challenge_id,
        set_key: updated.set_key,
        solved: updated.solved,
        code: updated.code,
        updated_at: new Date().toISOString()
      };

      this.logSyncPayload('practice_progress', 'upsert', userId, challengeId, record);
      this.saveStatus.setStatus('saving');

      if (!this.isOnline) {
        this.enqueueRetryItem(userId, 'practice_progress', 'upsert', challengeId, record, {
          code: 'OFFLINE',
          message: 'Client is offline'
        });
        this.saveStatus.setStatus('offline');
        return;
      }

      try {
        const { error } = await supabase.from('practice_progress').upsert(record, {
          onConflict: 'user_id,challenge_id'
        });

        if (error) {
          this.logSyncFailure('practice_progress', 'upsert', userId, challengeId, error);
          if (this.isRetryableError(error)) {
            this.enqueueRetryItem(userId, 'practice_progress', 'upsert', challengeId, record, error);
          } else {
            this.removeRetryItem(userId, 'practice_progress', challengeId);
            this.saveStatus.setStatus('failed', error.code === 'PGRST205' ? 'Database setup required' : 'Unable to save');
            return;
          }
        } else {
          this.removeRetryItem(userId, 'practice_progress', challengeId);
        }
      } catch (err) {
        this.logSyncFailure('practice_progress', 'upsert_exception', userId, challengeId, err);
        if (this.isRetryableError(err)) {
          this.enqueueRetryItem(userId, 'practice_progress', 'upsert', challengeId, record, err);
        } else {
          this.saveStatus.setStatus('failed');
          return;
        }
      }

      this.updateStatusAfterOperation(userId);
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
    const existing = this.cachedData.workbench[topicId] || {};

    const updated = {
      topic_id: topicId,
      html_content: html !== undefined ? html : existing.html_content,
      css_toggles: cssToggles !== undefined ? cssToggles : (existing.css_toggles || []),
      css_values: cssValues !== undefined ? cssValues : (existing.css_values || {})
    };

    this.cachedData.workbench[topicId] = updated;

    const runSave = async () => {
      const auth = await this.verifySession();
      if (!auth.isAuth) {
        this.saveStatus.setStatus('auth_required');
        return;
      }

      const userId = auth.userId;
      const record = {
        user_id: userId,
        topic_id: updated.topic_id,
        html_content: updated.html_content,
        css_toggles: updated.css_toggles,
        css_values: updated.css_values,
        updated_at: new Date().toISOString()
      };

      this.logSyncPayload('workbench_progress', 'upsert', userId, topicId, record);
      this.saveStatus.setStatus('saving');

      if (!this.isOnline) {
        this.enqueueRetryItem(userId, 'workbench_progress', 'upsert', topicId, record, {
          code: 'OFFLINE',
          message: 'Client is offline'
        });
        this.saveStatus.setStatus('offline');
        return;
      }

      try {
        const { error } = await supabase.from('workbench_progress').upsert(record, {
          onConflict: 'user_id,topic_id'
        });

        if (error) {
          this.logSyncFailure('workbench_progress', 'upsert', userId, topicId, error);
          if (this.isRetryableError(error)) {
            this.enqueueRetryItem(userId, 'workbench_progress', 'upsert', topicId, record, error);
          } else {
            this.removeRetryItem(userId, 'workbench_progress', topicId);
            this.saveStatus.setStatus('failed', error.code === 'PGRST205' ? 'Database setup required' : 'Unable to save');
            return;
          }
        } else {
          this.removeRetryItem(userId, 'workbench_progress', topicId);
        }
      } catch (err) {
        this.logSyncFailure('workbench_progress', 'upsert_exception', userId, topicId, err);
        if (this.isRetryableError(err)) {
          this.enqueueRetryItem(userId, 'workbench_progress', 'upsert', topicId, record, err);
        } else {
          this.saveStatus.setStatus('failed');
          return;
        }
      }

      this.updateStatusAfterOperation(userId);
    };

    if (immediate) {
      this.clearDebounce(`workbench_${topicId}`);
      await runSave();
    } else {
      this.debounce(`workbench_${topicId}`, runSave, 800);
    }
  }

  /**
   * Saves or updates profile information (full_name, roll_number, avatar_url).
   * @param {{ fullName?: string, rollNumber?: string, avatarUrl?: string|null }} payload
   * @param {boolean} [immediate=false]
   */
  async saveProfile({ fullName, rollNumber, avatarUrl }, immediate = false) {
    const existing = this.cachedData.profile || {};
    const updated = {
      full_name: fullName !== undefined ? fullName : (existing.full_name || ''),
      roll_number: rollNumber !== undefined ? rollNumber : (existing.roll_number || ''),
      avatar_url: avatarUrl !== undefined ? avatarUrl : (existing.avatar_url || null)
    };

    this.cachedData.profile = { ...(this.cachedData.profile || {}), ...updated };

    const runSave = async () => {
      const auth = await this.verifySession();
      if (!auth.isAuth) {
        this.saveStatus.setStatus('auth_required');
        return;
      }

      const userId = auth.userId;
      const record = {
        id: userId,
        full_name: updated.full_name,
        roll_number: updated.roll_number,
        avatar_url: updated.avatar_url,
        updated_at: new Date().toISOString()
      };

      this.logSyncPayload('profiles', 'upsert', userId, 'profile', record);
      this.saveStatus.setStatus('saving');

      if (!this.isOnline) {
        this.enqueueRetryItem(userId, 'profiles', 'upsert', 'profile', record, {
          code: 'OFFLINE',
          message: 'Client is offline'
        });
        this.saveStatus.setStatus('offline');
        return;
      }

      try {
        const { error } = await supabase.from('profiles').upsert(record, {
          onConflict: 'id'
        });

        if (error) {
          this.logSyncFailure('profiles', 'upsert', userId, 'profile', error);
          if (this.isRetryableError(error)) {
            this.enqueueRetryItem(userId, 'profiles', 'upsert', 'profile', record, error);
          } else {
            this.removeRetryItem(userId, 'profiles', 'profile');
            this.saveStatus.setStatus('failed', error.code === 'PGRST205' ? 'Database setup required' : 'Unable to save');
            return;
          }
        } else {
          this.removeRetryItem(userId, 'profiles', 'profile');
        }
      } catch (err) {
        this.logSyncFailure('profiles', 'upsert_exception', userId, 'profile', err);
        if (this.isRetryableError(err)) {
          this.enqueueRetryItem(userId, 'profiles', 'upsert', 'profile', record, err);
        } else {
          this.saveStatus.setStatus('failed');
          return;
        }
      }

      this.updateStatusAfterOperation(userId);
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
    this.cachedData.preferences = {
      ...(this.cachedData.preferences || {}),
      ...prefs
    };

    const runSave = async () => {
      const auth = await this.verifySession();
      if (!auth.isAuth) {
        this.saveStatus.setStatus('auth_required');
        return;
      }

      const userId = auth.userId;
      const current = this.cachedData.preferences;

      const record = {
        user_id: userId,
        theme: current.theme || 'dark',
        hide_topics: Boolean(current.hide_topics),
        last_topic_id: current.last_topic_id || 'navbar',
        last_practice_set: current.last_practice_set || 'HTM',
        last_practice_idx: Number.isInteger(current.last_practice_idx) ? current.last_practice_idx : 0,
        device_view: current.device_view || 'laptop',
        example_view: current.example_view || 'boxes',
        updated_at: new Date().toISOString()
      };

      this.logSyncPayload('user_preferences', 'upsert', userId, 'preferences', record);
      this.saveStatus.setStatus('saving');

      if (!this.isOnline) {
        this.enqueueRetryItem(userId, 'user_preferences', 'upsert', 'preferences', record, {
          code: 'OFFLINE',
          message: 'Client is offline'
        });
        this.saveStatus.setStatus('offline');
        return;
      }

      try {
        const { error } = await supabase.from('user_preferences').upsert(record, {
          onConflict: 'user_id'
        });

        if (error) {
          this.logSyncFailure('user_preferences', 'upsert', userId, 'preferences', error);
          if (this.isRetryableError(error)) {
            this.enqueueRetryItem(userId, 'user_preferences', 'upsert', 'preferences', record, error);
          } else {
            this.removeRetryItem(userId, 'user_preferences', 'preferences');
            this.saveStatus.setStatus('failed', error.code === 'PGRST205' ? 'Database setup required' : 'Unable to save');
            return;
          }
        } else {
          this.removeRetryItem(userId, 'user_preferences', 'preferences');
        }
      } catch (err) {
        this.logSyncFailure('user_preferences', 'upsert_exception', userId, 'preferences', err);
        if (this.isRetryableError(err)) {
          this.enqueueRetryItem(userId, 'user_preferences', 'upsert', 'preferences', record, err);
        } else {
          this.saveStatus.setStatus('failed');
          return;
        }
      }

      this.updateStatusAfterOperation(userId);
    };

    if (immediate) {
      this.clearDebounce('preferences_save');
      await runSave();
    } else {
      this.debounce('preferences_save', runSave, 600);
    }
  }

  /**
   * Updates save status accurately based on queue state.
   * Does NOT show "Sync retry pending" when there are no pending records!
   */
  updateStatusAfterOperation(userId = null) {
    const uid = userId || this.currentUser?.id;
    if (!uid) {
      this.saveStatus.setStatus('auth_required');
      return;
    }

    if (!this.isOnline) {
      this.saveStatus.setStatus('offline');
      return;
    }

    const queue = this.getUserQueue(uid);
    if (queue.length === 0) {
      this.saveStatus.setStatus('saved', 'Saved');
    } else {
      this.saveStatus.setStatus('retry_pending', 'Sync retry pending');
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
   * Retrieves the user-isolated pending retry queue from localStorage.
   */
  getUserQueue(userId) {
    if (!userId) return [];
    if (!this._memQueues) this._memQueues = new Map();
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(`${PENDING_QUEUE_PREFIX}${userId}`);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      }
      return this._memQueues.get(userId) || [];
    } catch (e) {
      console.warn('[UserDataService] Error reading user queue:', e);
      return this._memQueues?.get(userId) || [];
    }
  }

  /**
   * Saves the user-isolated pending retry queue to localStorage.
   */
  saveUserQueue(userId, queue) {
    if (!userId) return;
    if (!this._memQueues) this._memQueues = new Map();
    try {
      if (typeof localStorage !== 'undefined') {
        if (!queue || queue.length === 0) {
          localStorage.removeItem(`${PENDING_QUEUE_PREFIX}${userId}`);
        } else {
          localStorage.setItem(`${PENDING_QUEUE_PREFIX}${userId}`, JSON.stringify(queue));
        }
      } else {
        if (!queue || queue.length === 0) {
          this._memQueues.delete(userId);
        } else {
          this._memQueues.set(userId, queue);
        }
      }
    } catch (e) {
      console.warn('[UserDataService] Error saving user queue:', e);
      this._memQueues.set(userId, queue);
    }
  }

  /**
   * Adds or updates a retry item in the user-specific retry queue with exponential backoff calculation.
   */
  enqueueRetryItem(userId, table, operation, recordKey, record, error) {
    if (!userId) return;

    const queue = this.getUserQueue(userId);
    const existingIndex = queue.findIndex(
      (item) => item.table === table && item.recordKey === recordKey
    );

    const attempts = existingIndex >= 0 ? queue[existingIndex].attempts + 1 : 1;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s
    const backoffDelay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempts - 1, 5)));
    const nextRetryAt = Date.now() + backoffDelay;

    const queueItem = {
      id: `${table}_${recordKey}_${Date.now()}`,
      userId,
      table,
      operation,
      recordKey,
      payload: record,
      createdAt: existingIndex >= 0 ? queue[existingIndex].createdAt : new Date().toISOString(),
      attempts,
      lastError: {
        code: error?.code || null,
        message: error?.message || (typeof error === 'string' ? error : 'Unknown error'),
        details: error?.details || null,
        hint: error?.hint || null
      },
      nextRetryAt
    };

    if (existingIndex >= 0) {
      queue[existingIndex] = queueItem;
    } else {
      queue.push(queueItem);
    }

    this.saveUserQueue(userId, queue);
    console.warn(
      `[UserDataService] Item queued for retry (table: ${table}, key: ${recordKey}, attempt: ${attempts}, backoff: ${backoffDelay}ms). Total pending: ${queue.length}`
    );

    // Schedule next retry check
    this.scheduleNextRetry(userId, backoffDelay);
  }

  /**
   * Removes a successfully saved or non-retryable item from the user's retry queue.
   */
  removeRetryItem(userId, table, recordKey) {
    if (!userId) return;
    const queue = this.getUserQueue(userId);
    const filtered = queue.filter(
      (item) => !(item.table === table && item.recordKey === recordKey)
    );
    if (filtered.length !== queue.length) {
      this.saveUserQueue(userId, filtered);
    }
  }

  scheduleNextRetry(userId, delayMs) {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
    this.retryTimeoutId = setTimeout(() => {
      this.retryTimeoutId = null;
      if (this.isOnline && this.currentUser?.id === userId) {
        this.syncPendingQueue();
      }
    }, Math.max(delayMs, 1000));
  }

  /**
   * Migrates legacy un-scoped queue if found from older sessions.
   */
  migrateLegacyQueue() {
    try {
      const raw = localStorage.getItem(LEGACY_PENDING_QUEUE_KEY);
      if (!raw) return;

      const legacy = JSON.parse(raw);
      if (Array.isArray(legacy) && legacy.length > 0) {
        for (const item of legacy) {
          const uid = item.record?.user_id || item.record?.id;
          if (uid) {
            let recordKey = 'unknown';
            if (item.table === 'practice_progress') recordKey = item.record.challenge_id;
            else if (item.table === 'workbench_progress') recordKey = item.record.topic_id;
            else if (item.table === 'profiles') recordKey = 'profile';
            else if (item.table === 'user_preferences') recordKey = 'preferences';

            this.enqueueRetryItem(uid, item.table, 'upsert', recordKey, item.record, {
              code: 'LEGACY_MIGRATION',
              message: 'Migrated from legacy queue'
            });
          }
        }
      }
      localStorage.removeItem(LEGACY_PENDING_QUEUE_KEY);
    } catch (e) {
      console.warn('[UserDataService] Error migrating legacy queue:', e);
    }
  }

  /**
   * Synchronizes queued retry items to Supabase PostgreSQL with exponential backoff
   * and permanent error filtering.
   */
  async syncPendingQueue() {
    const auth = await this.verifySession();
    if (!auth.isAuth || this.isSyncing) return;

    const userId = auth.userId;
    this.isSyncing = true;

    try {
      const queue = this.getUserQueue(userId);
      if (queue.length === 0) {
        this.saveStatus.setStatus('saved', 'Saved');
        this.isSyncing = false;
        return;
      }

      console.log(`[UserDataService] Processing retry queue for user ${userId} (${queue.length} items)...`);
      const remaining = [];
      const now = Date.now();

      for (const item of queue) {
        // Only process items whose backoff delay has matured
        if (item.nextRetryAt > now) {
          remaining.push(item);
          continue;
        }

        // Prevent hammering: after 5 attempts, halt automatic retry loops
        if (item.attempts >= 5) {
          console.error(
            `[UserDataService] Item exceeded maximum retry attempts (${item.attempts}). Halting retries for ${item.table} (${item.recordKey}):`,
            item.lastError
          );
          // Keep in queue for manual retry or remove non-retryable
          if (!this.isRetryableError(item.lastError)) {
            continue; // Dropped from retry queue to stop infinite loop
          }
          remaining.push(item);
          continue;
        }

        try {
          let conflictKey = 'user_id';
          if (item.table === 'practice_progress') conflictKey = 'user_id,challenge_id';
          else if (item.table === 'workbench_progress') conflictKey = 'user_id,topic_id';
          else if (item.table === 'profiles') conflictKey = 'id';
          else if (item.table === 'user_preferences') conflictKey = 'user_id';

          this.logSyncPayload(item.table, 'retry_upsert', userId, item.recordKey, item.payload);

          const { error } = await supabase.from(item.table).upsert(item.payload, {
            onConflict: conflictKey
          });

          if (error) {
            this.logSyncFailure(item.table, 'retry_upsert', userId, item.recordKey, error);

            if (this.isRetryableError(error)) {
              item.attempts += 1;
              const backoff = Math.min(30000, 1000 * Math.pow(2, Math.min(item.attempts - 1, 5)));
              item.nextRetryAt = Date.now() + backoff;
              item.lastError = {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint
              };
              remaining.push(item);
            } else {
              // Non-retryable error (e.g. PGRST205 missing table): remove to prevent endless retry loops!
              console.warn(
                `[UserDataService] Removing non-retryable failed item from queue (${item.table}, code: ${error.code}).`
              );
            }
          } else {
            console.log(`[UserDataService] Successfully synced queued item for ${item.table} (${item.recordKey})!`);
          }
        } catch (itemErr) {
          this.logSyncFailure(item.table, 'retry_exception', userId, item.recordKey, itemErr);
          if (this.isRetryableError(itemErr)) {
            item.attempts += 1;
            item.nextRetryAt = Date.now() + 2000;
            remaining.push(item);
          }
        }
      }

      this.saveUserQueue(userId, remaining);

      if (remaining.length === 0) {
        this.saveStatus.setStatus('saved', 'Saved');
        console.log('[UserDataService] All pending items successfully synchronized to Supabase!');
      } else {
        const nextTime = Math.min(...remaining.map((i) => i.nextRetryAt));
        const delay = Math.max(1000, nextTime - Date.now());
        this.saveStatus.setStatus('retry_pending', 'Sync retry pending');
        this.scheduleNextRetry(userId, delay);
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
