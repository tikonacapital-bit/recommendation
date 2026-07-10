#!/bin/bash
# ==============================================================================
# AlphaLens VPS Update & Redeploy Script
# ==============================================================================
# Run this script on your VPS inside /var/www/recommendation:
#   chmod +x deploy_update.sh
#   sudo ./deploy_update.sh
# ==============================================================================

set -e

PROJECT_DIR="/var/www/recommendation"
USER_NAME="ubuntu"

echo "=== 1. Pulling latest code from GitHub ==="
cd "$PROJECT_DIR"
# Force ownership if files were modified by root
chown -R "$USER_NAME":"$USER_NAME" "$PROJECT_DIR"
sudo -u "$USER_NAME" git pull origin main

echo "=== 2. Updating Python Dependencies ==="
sudo -u "$USER_NAME" ./venv/bin/pip install --upgrade pip
sudo -u "$USER_NAME" ./venv/bin/pip install -r requirements.txt

echo "=== 3. Rebuilding Frontend ==="
cd "$PROJECT_DIR/frontend"
sudo -u "$USER_NAME" sh -c "echo 'VITE_API_BASE_URL=/' > .env.production"
sudo -u "$USER_NAME" npm install
sudo -u "$USER_NAME" npm run build

echo "=== 4. Restarting Services ==="
systemctl daemon-reload
systemctl restart alphalens-backend
systemctl restart alphalens-worker
systemctl restart nginx

echo "=== 5. Verifying Service Status ==="
systemctl status alphalens-backend --no-pager
systemctl status alphalens-worker --no-pager

echo "=============================================================================="
echo "🎉 Update Complete!"
echo "If you see a 502 Bad Gateway, check the logs with: "
echo "   sudo journalctl -u alphalens-backend -n 50 --no-pager"
echo "=============================================================================="
