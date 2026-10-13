// Ozari spend cap — deployed by Terraform (modules/gcp-env/spend-cap.tf). Do not deploy by hand.
//
// A Google Cloud budget only SENDS ALERTS; nothing stops spending on its own. This function is the
// enforcement Google documents for a hard cap: the budget publishes its running cost to Pub/Sub
// several times a day, and once the month's cost reaches the budget, this unlinks THIS project from
// its billing account. Every paid service in the project stops at that moment — the API goes down —
// which is exactly the trade the owner chose over an open-ended bill.
//
// Recovery is deliberate and manual (INCIDENTS.md S12): find out why, raise the budget if it was
// legitimate, then `tf.ps1 <env> bootstrap plan` + `apply` re-links billing.
//
// It can do exactly one thing: its service account holds Project Billing Manager on this project
// only. It never touches the billing account, other projects, or any data.
//
// Testing without consequences: a message carrying the attribute `dryRun=true` runs the whole
// decision and the permission check, and logs WOULD instead of acting. Budgets never set it.

import * as functions from '@google-cloud/functions-framework';

const PROJECT_ID = process.env.PROJECT_ID;
const BILLING_INFO = `https://cloudbilling.googleapis.com/v1/projects/${PROJECT_ID}/billingInfo`;
const TEST_PERMISSIONS = `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:testIamPermissions`;
const TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

const log = (severity, message, fields = {}) =>
  console.log(JSON.stringify({ severity, message, project: PROJECT_ID, ...fields }));

async function accessToken() {
  const res = await fetch(TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`metadata token: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

functions.cloudEvent('capSpend', async (cloudEvent) => {
  const message = cloudEvent.data?.message;
  if (!message?.data) {
    log('WARNING', 'Spend cap: message without data, ignored');
    return;
  }

  const notification = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
  const cost = Number(notification.costAmount);
  const budget = Number(notification.budgetAmount);
  const dryRun = message.attributes?.dryRun === 'true';
  const fields = { cost, budget, currency: notification.currencyCode, dryRun };

  // A budget of 0 (or garbage) is a misconfiguration, never a reason to switch production off.
  if (!Number.isFinite(cost) || !Number.isFinite(budget) || budget <= 0) {
    log('WARNING', 'Spend cap: unusable notification, ignored', fields);
    return;
  }
  if (cost < budget) {
    log('INFO', `Spend cap: ${cost} of ${budget} used — under the cap`, fields);
    return;
  }

  const auth = { Authorization: `Bearer ${await accessToken()}` };

  if (dryRun) {
    const res = await fetch(TEST_PERMISSIONS, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['resourcemanager.projects.deleteBillingAssignment'] }),
    });
    const granted = res.ok ? ((await res.json()).permissions ?? []) : [];
    log('NOTICE', `Spend cap DRY RUN: WOULD unlink billing (permission ${granted.length ? 'OK' : 'MISSING'})`, {
      ...fields,
      permissionGranted: granted.length > 0,
    });
    return;
  }

  const current = await fetch(BILLING_INFO, { headers: auth });
  if (!current.ok) throw new Error(`read billingInfo: HTTP ${current.status} ${await current.text()}`);
  if (!(await current.json()).billingEnabled) {
    log('INFO', 'Spend cap: billing is already unlinked', fields);
    return;
  }

  // Throwing makes Pub/Sub retry, so a transient failure cannot leave the cap unenforced.
  const res = await fetch(BILLING_INFO, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ billingAccountName: '' }),
  });
  if (!res.ok) throw new Error(`unlink billing: HTTP ${res.status} ${await res.text()}`);
  log('ALERT', `SPEND CAP REACHED: billing unlinked from ${PROJECT_ID}. Every paid service is stopped.`, fields);
});
