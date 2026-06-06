#!/bin/bash

# Environment setup script for different Firebase projects
# This helps manage staging vs production deployments

case "$1" in
  staging)
    echo "Setting up for STAGING environment..."
    export FIREBASE_PROJECT=$FIREBASE_PROJECT_ID_STAGING
    firebase use staging
    ;;
  production)
    echo "Setting up for PRODUCTION environment..."
    export FIREBASE_PROJECT=$FIREBASE_PROJECT_ID
    firebase use production
    ;;
  *)
    echo "Usage: $0 {staging|production}"
    exit 1
    ;;
esac

echo "Current Firebase project: $(firebase use)"
