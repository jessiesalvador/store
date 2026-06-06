# Firebase Staging Deployment

This branch deploys to Firebase project `jsstore-staging` through GitHub Actions.

## GitHub Secret

Add one repository secret:

- `FIREBASE_SERVICE_ACCOUNT`: the raw JSON contents of a service-account key for the `jsstore-staging` Firebase project.

The workflow uses `google-github-actions/auth` with `credentials_json`, so this secret should be JSON, not a Firebase CLI token.

## Workflow

The staging workflow is `.github/workflows/deploy-staging.yml`.

It runs on:

- pushes to `jessiesalvador-patch-1`
- manual runs from the GitHub Actions tab

It deploys:

- Firebase Hosting from `store/`
- Firebase Functions from `store2/`
- Firestore indexes from `firestore.indexes.json`

## Service Account Access

The service account must have enough access in `jsstore-staging` to deploy Hosting, Cloud Functions for Firebase, and Firestore indexes. For Functions deploys, Firebase specifically requires Cloud Functions Admin and Service Account User permissions unless deployment is delegated to a project Owner.
