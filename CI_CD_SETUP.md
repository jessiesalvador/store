# GitHub Actions CI/CD Setup Guide

This guide will help you set up the CI/CD pipeline for automatic deployments to Firebase.

## Prerequisites

1. GitHub repository with this code
2. Firebase projects (one for staging, one for production)
3. Firebase CLI token

## Step 1: Create Firebase Tokens

Generate a Firebase token that GitHub Actions will use to deploy:

```bash
firebase login:ci
```

This will open a browser and give you a token. **Keep this token secure** — you'll add it as a secret.

## Step 2: Set Up GitHub Secrets

Go to your GitHub repository settings and add the following secrets:

### Required Secrets:

1. **`FIREBASE_TOKEN`** - The token you generated above
2. **`FIREBASE_PROJECT_ID`** - Your production Firebase project ID
3. **`FIREBASE_PROJECT_ID_STAGING`** - Your staging Firebase project ID

### Optional Secrets:

4. **`SLACK_WEBHOOK`** - (Optional) Slack webhook URL for notifications

### How to Add Secrets:

1. Go to GitHub repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each secret with the name and value

## Step 3: Configure Your Firebase Projects

Make sure you have two separate Firebase projects:
- One for **production** (used by main branch)
- One for **staging** (used by pull requests)

## Step 4: Verify firebase.json

Ensure your `firebase.json` is configured correctly:

```json
{
  "functions": [
    {
      "source": "store2",
      "codebase": "default"
    }
  ],
  "firestore": {
    "indexes": "firestore.indexes.json"
  },
  "hosting": {
    "public": "store"
  }
}
```

## Workflow Triggers

### Staging Deployment (`deploy-staging.yml`)
- **Triggered on:** Pull requests to `main` or `develop`
- **What it does:**
  - Installs dependencies
  - Runs tests
  - Deploys to staging Firebase project
  - Comments on PR with deployment info

### Production Deployment (`deploy-production.yml`)
- **Triggered on:** Push to `main` branch
- **What it does:**
  - Installs dependencies
  - Runs tests
  - Deploys to production Firebase project
  - Creates GitHub deployment status
  - Sends Slack notification (if configured)

## Testing the Pipeline

1. Create a pull request to `main`
   - GitHub Actions should automatically run the staging workflow
   - Check the "Actions" tab to see the deployment progress

2. Merge the PR to `main`
   - GitHub Actions should automatically run the production workflow
   - Your code will be deployed to production Firebase

## Troubleshooting

### Issue: Deployment fails with permission error
**Solution:** Make sure the Firebase token has the necessary permissions:
```bash
firebase login:ci
```

### Issue: Node modules not found
**Solution:** Verify that `store2/package-lock.json` exists and is committed to git.

### Issue: Firebase project not found
**Solution:** Double-check your `FIREBASE_PROJECT_ID` and `FIREBASE_PROJECT_ID_STAGING` secrets match your actual project IDs.

### Issue: Hosting deployment fails
**Solution:** Ensure your `firebase.json` correctly points to the hosting directory (`store/` in your case).

## Environment Variables

If your Firebase functions need environment variables, create a `.env.production` and `.env.staging` file in the `store2` directory and ensure they're added to GitHub secrets if needed.

## Next Steps

1. Push the workflow files to GitHub:
   ```bash
   git add .github/workflows/
   git commit -m "Add CI/CD pipeline"
   git push origin main
   ```

2. Add the required secrets to GitHub

3. Test by creating a pull request

## Monitoring Deployments

- Check GitHub Actions tab for workflow runs and logs
- Use `firebase deploy --debug` locally to test deployments
- Monitor your Firebase console for successful deployments
