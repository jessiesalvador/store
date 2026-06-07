# Firebase Staging Deployment

This branch deploys to Firebase project `jsstore-staging` through GitHub Actions.

## GitHub Secret

Add one repository secret:

- `FIREBASE_SERVICE_ACCOUNT`: the raw JSON contents of a service-account key for the `jsstore-staging` Firebase project.
- `STAGING_SUPER_ADMIN_PASSWORD`: password used when manually seeding the staging super-admin account.

The workflow uses `google-github-actions/auth` with `credentials_json`, so this secret should be JSON, not a Firebase CLI token.

Optional seed secrets:

- `STAGING_SUPER_ADMIN_EMAIL`: defaults to `ai.jessie@outlook.com` when omitted.
- `STAGING_STORE_ADMIN_EMAIL`: defaults to `eisse_jay@yahoo.com` when omitted.
- `STAGING_STORE_ADMIN_PASSWORD`: defaults to `STAGING_SUPER_ADMIN_PASSWORD` when omitted.

## Workflow

The staging workflow is `.github/workflows/deploy-staging.yml`.

It runs on:

- pushes to `jessiesalvador-patch-1`
- manual runs from the GitHub Actions tab

It deploys:

- Firebase Hosting from `store/`
- Firebase Functions from `store2/`
- Firestore indexes from `firestore.indexes.json`

For a new empty staging project, run the workflow manually and enable `seed_data`. That runs `npm run seed` after deployment and creates:

- approved stores, including slug `freshcart`
- default grocery items
- a super-admin user
- a FreshCart store-admin user

## Service Account Access

The service account must have enough access in `jsstore-staging` to deploy Hosting, Cloud Functions for Firebase, and Firestore indexes. For Functions deploys, Firebase specifically requires Cloud Functions Admin and Service Account User permissions unless deployment is delegated to a project Owner.
