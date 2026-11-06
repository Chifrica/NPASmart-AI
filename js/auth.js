// DEMO ONLY: credentials in frontend code are visible to anyone who can inspect the site.
// Replace this module with Supabase Auth or a secure server-side auth flow before deployment.
const DEMO_USERNAME = 'Admin';
const DEMO_PASSWORD = 'Admin';
const SESSION_KEY = 'docusmart-demo-session';

export function signIn(username, password) {
  if (username === DEMO_USERNAME && password === DEMO_PASSWORD) {
    sessionStorage.setItem(SESSION_KEY, 'active');
    return true;
  }
  return false;
}
export function isSignedIn() { return sessionStorage.getItem(SESSION_KEY) === 'active'; }
export function signOut() { sessionStorage.removeItem(SESSION_KEY); }
