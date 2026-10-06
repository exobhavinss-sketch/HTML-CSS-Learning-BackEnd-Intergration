-- ============================================================================
-- TAG FINDER — AVATAR STORAGE BUCKET & RLS POLICIES MIGRATION
-- Migration: 002_avatar_storage.sql
-- Description: Creates the 'avatars' storage bucket and sets up secure Row Level
--              Security (RLS) policies for user profile pictures.
-- ============================================================================

-- 1. Create the 'avatars' storage bucket if it does not already exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,                         -- Public bucket: images can be rendered in <img> tags
  5242880,                      -- 5 MB file size limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

-- NOTE: RLS is already enabled on storage.objects by Supabase by default.
-- Do NOT run ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY as it requires
-- the supabase_storage_admin owner role and will error in the SQL editor.

-- 2. Storage Policies for 'avatars' Bucket

-- A. PUBLIC SELECT POLICY
-- Anyone can view avatar images (required for public profile pictures)
DROP POLICY IF EXISTS "Public avatars viewable by everyone" ON storage.objects;
CREATE POLICY "Public avatars viewable by everyone"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- B. AUTHENTICATED INSERT POLICY
-- Users can only upload their own avatar into their designated user folder:
-- avatars/{user_id}/...
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- C. AUTHENTICATED UPDATE POLICY
-- Users can only update their own avatar files
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- D. AUTHENTICATED DELETE POLICY
-- Users can only delete their own avatar files
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3. Verify public.profiles table has avatar_url column (from migration 001)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'avatar_url'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN avatar_url TEXT;
  END IF;
END $$;
