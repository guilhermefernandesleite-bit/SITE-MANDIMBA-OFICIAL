import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://psohvzcwxxiplstngzty.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb2h2emN3eHhpcGxzdG5nenR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NTE1NjMsImV4cCI6MjA5MTMyNzU2M30.5uYQWrFeVA1ffuTt6SNKVnPS-NoVkIVplB4ymw0VVOQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}
