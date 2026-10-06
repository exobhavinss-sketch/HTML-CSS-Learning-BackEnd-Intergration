# User Data Persistence & Learning Progress Architecture

## Overview

The **HTML & CSS Tag Finder** application implements a persistent cloud-backed user progress and learning state system.
Supabase PostgreSQL is the permanent **Source of Truth** for all authenticated user progress, practice solutions, custom workbench edits, and user preferences.
Browser storage (`localStorage`) is used strictly as a resilient offline cache and pending synchronization queue.

---

## 1. Database Architecture & Schema

All user-owned data is stored in normalized Supabase PostgreSQL tables linked to Supabase Auth (`auth.users.id`).
Ownership is strictly enforced at the database layer via `auth.uid()`.

### A. `profiles` Table
Stores extended user profile information.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE` | References Supabase Auth user ID. |
| `full_name` | `TEXT` | `DEFAULT '' NOT NULL` | Student or user full name. |
| `roll_number` | `TEXT` | `DEFAULT '' NOT NULL` | Student roll number for practice completion code verification. |
| `avatar_url` | `TEXT` | `NULLABLE` | Optional avatar image URL. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT timezone('utc', now()) NOT NULL` | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT timezone('utc', now()) NOT NULL` | Last update timestamp. |

### B. `practice_progress` Table
Stores challenge completion status, custom submitted/in-progress HTML or CSS code, and set categorization.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique record identifier. |
| `user_id` | `UUID` | `NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` | Authenticated owner ID. |
| `challenge_id` | `TEXT` | `NOT NULL` | Unique challenge identifier (e.g. `p-htm-1`, `p-css-3`). |
| `set_key` | `TEXT` | `NOT NULL` | Practice set group (`HTM`, `CSS`, `FLX`, `GRD`, `POS`). |
| `solved` | `BOOLEAN` | `DEFAULT false NOT NULL` | Whether the challenge test assertions passed. |
| `code` | `TEXT` | `DEFAULT '' NOT NULL` | User's written code/solution for this challenge. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT timezone('utc', now()) NOT NULL` | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT timezone('utc', now()) NOT NULL` | Last update timestamp. |

- **Unique Constraint**: `UNIQUE (user_id, challenge_id)` ensures exactly one persistent record per challenge per user.

### C. `workbench_progress` Table
Stores custom interactive playground edits across workbench learning topics.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique record identifier. |
| `user_id` | `UUID` | `NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` | Authenticated owner ID. |
| `topic_id` | `TEXT` | `NOT NULL` | Topic ID (e.g. `navbar`, `flex`, `cards`). |
| `html_content` | `TEXT` | `NULLABLE` | Custom HTML written in the workbench code editor. |
| `css_toggles` | `JSONB` | `DEFAULT '[]'::jsonb NOT NULL` | Boolean array indicating which CSS lines are turned on. |
| `css_values` | `JSONB` | `DEFAULT '{}'::jsonb NOT NULL` | Map of dropdown values selected for CSS properties. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT timezone('utc', now()) NOT NULL` | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT timezone('utc', now()) NOT NULL` | Last update timestamp. |

- **Unique Constraint**: `UNIQUE (user_id, topic_id)` ensures clean topic-level isolation.

### D. `user_preferences` Table
Persists cross-device user preferences and active session states.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique record identifier. |
| `user_id` | `UUID` | `NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` | Authenticated owner ID. |
| `theme` | `TEXT` | `DEFAULT 'dark' NOT NULL` | Preferred UI theme (`'dark'` or `'light'`). |
| `hide_topics` | `BOOLEAN` | `DEFAULT false NOT NULL` | Whether the topics navigation sidebar is collapsed. |
| `last_topic_id` | `TEXT` | `DEFAULT 'navbar' NOT NULL` | Last visited topic ID. |
| `last_practice_set` | `TEXT` | `DEFAULT 'HTM' NOT NULL` | Last active practice set tab. |
| `last_practice_idx` | `INTEGER` | `DEFAULT 0 NOT NULL` | Last active practice challenge index. |
| `device_view` | `TEXT` | `DEFAULT 'laptop' NOT NULL` | Preview device simulation (`'laptop'` or `'phone'`). |
| `example_view` | `TEXT` | `DEFAULT 'boxes' NOT NULL` | Example view mode (`'boxes'` or `'real'`). |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT timezone('utc', now()) NOT NULL` | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT timezone('utc', now()) NOT NULL` | Last update timestamp. |

- **Unique Constraint**: `UNIQUE (user_id)` maintains exactly one preferences row per user.

---

## 2. Row Level Security (RLS) & Ownership Isolation

Row Level Security is enabled on **all four** tables:
```sql
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbench_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
```

### Strict Policies:
- **`profiles`**:
  - `SELECT`, `INSERT`, `UPDATE`, `DELETE` with `auth.uid() = id`.
- **`practice_progress`**:
  - `SELECT`, `INSERT`, `UPDATE`, `DELETE` with `auth.uid() = user_id`.
- **`workbench_progress`**:
  - `SELECT`, `INSERT`, `UPDATE`, `DELETE` with `auth.uid() = user_id`.
- **`user_preferences`**:
  - `SELECT`, `INSERT`, `UPDATE`, `DELETE` with `auth.uid() = user_id`.

No client request can ever query or mutate another user's rows, even if frontend parameters or requests are manually crafted.

---

## 3. High-Performance Indexes

The following indexes guarantee sub-millisecond query execution:
```sql
CREATE INDEX idx_practice_progress_user_id ON public.practice_progress(user_id);
CREATE INDEX idx_practice_progress_user_challenge ON public.practice_progress(user_id, challenge_id);
CREATE INDEX idx_workbench_progress_user_id ON public.workbench_progress(user_id);
CREATE INDEX idx_workbench_progress_user_topic ON public.workbench_progress(user_id, topic_id);
CREATE INDEX idx_user_preferences_user_id ON public.user_preferences(user_id);
CREATE INDEX idx_profiles_id ON public.profiles(id);
```

---

## 4. Application Data Flow & Service Architecture

```
User Action (Code Edit / Challenge Solve / CSS Toggle)
       ↓
Optimistic UI Update (Immediate visual response)
       ↓
UserDataService (js/userDataService.js)
       ├── Code / HTML Editor: Debounced (600–800ms)
       └── Solve / Toggle / Settings: Immediate Upsert
       ↓
Online Check:
   ├── Online → Supabase PostgreSQL Upsert (RLS: auth.uid())
   └── Offline → Local Pending Queue (localStorage)
       ↓
Save Status Indicator:
   ● Saved | Saving... | Offline (cached) | Syncing...
```

### Automatic Saving Rules:
1. **Challenge Solve**: Immediately upserted when test checks pass.
2. **Challenge Code Input**: Debounced at 800ms after typing pauses.
3. **HTML Workbench Editor**: Debounced at 800ms after typing pauses.
4. **CSS Toggles & Dropdowns**: Saved immediately upon checkbox or select change.
5. **Theme & Sidebar Preferences**: Saved immediately upon user toggle.
6. **Student Name & Roll Number**: Debounced at 600ms and synced to `profiles`.

---

## 5. Login Restoration Flow

When a user signs in (`SIGNED_IN` or page reload with active session):
1. Detect authenticated user ID (`auth.users.id`).
2. Show topbar status: `Loading progress...`.
3. Efficiently query `profiles`, `practice_progress`, `workbench_progress`, and `user_preferences` in parallel via `Promise.allSettled`.
4. If local progress exists in `localStorage` from a previous unauthenticated session, automatically migrate non-conflicting records to Supabase.
5. Call `window.restoreUserDataFromService(data)` to populate:
   - Challenge solved statuses and saved code solutions in `PS`.
   - Workbench custom HTML, CSS line toggles, and dropdown values in `state`.
   - Name and roll number inputs in the DOM.
   - Theme and sidebar visibility in the layout.
6. Re-render active view.
7. Show topbar status: `● Saved`.

---

## 6. Safe Logout Architecture

When a user clicks **Sign Out**:
1. Flush all pending debounced saves to Supabase (`userDataService.flushAllPending()`).
2. Call `supabase.auth.signOut()`.
3. Clear in-memory user cache and state (`userDataService.handleUserSignOut()`).
4. Call `window.resetToLoggedOutState()` to return the DOM to public, default state.
5. **NEVER DELETE DATABASE RECORDS**: Logout terminates the local browser session; all database progress remains permanent in Supabase PostgreSQL for when the user logs back in.

---

## 7. Offline & Network Interruption Handling

1. When offline (`navigator.onLine === false` or API failure):
   - Changes are queued locally in `tagfinder_pending_sync_v1`.
   - The status indicator displays `Offline (cached)`.
2. When connection is restored (`window.addEventListener('online')`):
   - Status updates to `Syncing...`.
   - All queued pending records are sent to Supabase via bulk upsert.
   - Queue is emptied upon successful response, and status returns to `● Saved`.
