-- ============================================================================
-- TAG FINDER — USER DATA PERSISTENCE & LEARNING PROGRESS MIGRATION
-- Migration: 001_user_data_persistence.sql
-- Description: Creates normalized tables, RLS policies, indexes, and triggers
--              for permanent Supabase PostgreSQL persistence of user learning data.
-- ============================================================================

-- Enable pgcrypto for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. PROFILES TABLE
-- Stores user-specific profile details linked to auth.users.
-- ID directly references auth.users(id) with CASCADE deletion on account removal.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT DEFAULT '' NOT NULL,
  roll_number TEXT DEFAULT '' NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================================
-- 2. PRACTICE PROGRESS TABLE
-- Stores individual challenge completion state, submitted/in-progress code,
-- and set categorization. Unique per (user_id, challenge_id).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.practice_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  set_key TEXT NOT NULL,
  solved BOOLEAN DEFAULT false NOT NULL,
  code TEXT DEFAULT '' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_practice_user_challenge UNIQUE (user_id, challenge_id)
);

-- ============================================================================
-- 3. WORKBENCH PROGRESS TABLE
-- Stores custom HTML edits, active CSS toggle states, and interactive dropdown
-- values per workbench topic. Unique per (user_id, topic_id).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.workbench_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  html_content TEXT,
  css_toggles JSONB DEFAULT '[]'::jsonb NOT NULL,
  css_values JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_workbench_user_topic UNIQUE (user_id, topic_id)
);

-- ============================================================================
-- 4. USER PREFERENCES TABLE
-- Stores UI preferences and session positions (theme, sidebar, last topic, etc.).
-- Exactly one record per user (UNIQUE on user_id).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'dark' NOT NULL,
  hide_topics BOOLEAN DEFAULT false NOT NULL,
  last_topic_id TEXT DEFAULT 'navbar' NOT NULL,
  last_practice_set TEXT DEFAULT 'HTM' NOT NULL,
  last_practice_idx INTEGER DEFAULT 0 NOT NULL,
  device_view TEXT DEFAULT 'laptop' NOT NULL,
  example_view TEXT DEFAULT 'boxes' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_user_preferences_user UNIQUE (user_id)
);

-- ============================================================================
-- 5. AUTOMATIC updated_at TIMESTAMP TRIGGER FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
DROP TRIGGER IF EXISTS tr_profiles_updated_at ON public.profiles;
CREATE TRIGGER tr_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_practice_progress_updated_at ON public.practice_progress;
CREATE TRIGGER tr_practice_progress_updated_at
  BEFORE UPDATE ON public.practice_progress
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_workbench_progress_updated_at ON public.workbench_progress;
CREATE TRIGGER tr_workbench_progress_updated_at
  BEFORE UPDATE ON public.workbench_progress
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER tr_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 6. AUTOMATIC PROFILE CREATION TRIGGER ON SIGNUP
-- Automatically seeds the profiles and user_preferences row when a new user
-- registers via Supabase Auth.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, roll_number)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'roll_number', '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 7. PERFORMANCE INDEXES
-- Index frequently queried columns for high throughput and sub-millisecond lookups.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_practice_progress_user_id ON public.practice_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_progress_user_challenge ON public.practice_progress(user_id, challenge_id);
CREATE INDEX IF NOT EXISTS idx_workbench_progress_user_id ON public.workbench_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_workbench_progress_user_topic ON public.workbench_progress(user_id, topic_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_id ON public.profiles(id);

-- ============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- Strict user ownership isolation.
-- Every user-owned table has RLS enabled.
-- Users can ONLY SELECT, INSERT, UPDATE, DELETE rows where user_id = auth.uid()
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbench_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- PROFILES POLICIES
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY "Users can delete own profile"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- PRACTICE PROGRESS POLICIES
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own practice progress" ON public.practice_progress;
CREATE POLICY "Users can view own practice progress"
  ON public.practice_progress FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own practice progress" ON public.practice_progress;
CREATE POLICY "Users can insert own practice progress"
  ON public.practice_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own practice progress" ON public.practice_progress;
CREATE POLICY "Users can update own practice progress"
  ON public.practice_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own practice progress" ON public.practice_progress;
CREATE POLICY "Users can delete own practice progress"
  ON public.practice_progress FOR DELETE
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- WORKBENCH PROGRESS POLICIES
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own workbench progress" ON public.workbench_progress;
CREATE POLICY "Users can view own workbench progress"
  ON public.workbench_progress FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own workbench progress" ON public.workbench_progress;
CREATE POLICY "Users can insert own workbench progress"
  ON public.workbench_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own workbench progress" ON public.workbench_progress;
CREATE POLICY "Users can update own workbench progress"
  ON public.workbench_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own workbench progress" ON public.workbench_progress;
CREATE POLICY "Users can delete own workbench progress"
  ON public.workbench_progress FOR DELETE
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- USER PREFERENCES POLICIES
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own preferences" ON public.user_preferences;
CREATE POLICY "Users can view own preferences"
  ON public.user_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own preferences" ON public.user_preferences;
CREATE POLICY "Users can insert own preferences"
  ON public.user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
CREATE POLICY "Users can update own preferences"
  ON public.user_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own preferences" ON public.user_preferences;
CREATE POLICY "Users can delete own preferences"
  ON public.user_preferences FOR DELETE
  USING (auth.uid() = user_id);
