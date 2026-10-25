import { execSync } from 'child_process';
try {
  console.log('STAGING + COMMIT...');
  execSync('git add -A', { stdio: 'inherit' });
  execSync('git commit -m "audit: dependency pass (zod 4.6.7 + audit clean), weekly vulnerability automation (cron+script), sqlite removal (mysql only), auth/CSP fixes, docs updated, broken components cleaned"', { stdio: 'inherit' });
  console.log('COMMIT_OK');
} catch (e) {
  console.log('COMMIT_FAIL:', e.message);
}
