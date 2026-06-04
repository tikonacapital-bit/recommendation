#!/bin/bash
# ==============================================================================
# AlphaLens VPS Auto-Deployment Script (Ubuntu 20.04 / 22.04)
# ==============================================================================
# Run this script on your VPS as root or using sudo:
#   chmod +x deploy_vps.sh
#   sudo ./deploy_vps.sh
# ==============================================================================

set -e

PROJECT_DIR="/var/www/recommendation"
USER_NAME="ubuntu" # Change if deploying under a different system user

echo "=== 1. Installing System Dependencies ==="
apt-get update
apt-get install -y curl git python3-pip python3-venv redis-server nginx

# Install Node.js (v18+)
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

echo "=== 2. Setting Up Project Directories ==="
mkdir -p "$PROJECT_DIR"
# Copy current repository files to /var/www/recommendation
cp -r . "$PROJECT_DIR"
chown -R "$USER_NAME":"$USER_NAME" "$PROJECT_DIR"

cd "$PROJECT_DIR"

echo "=== 3. Setting Up Python Virtual Environment ==="
sudo -u "$USER_NAME" python3 -m venv venv
sudo -u "$USER_NAME" ./venv/bin/pip install --upgrade pip
sudo -u "$USER_NAME" ./venv/bin/pip install -r requirements.txt

echo "=== 4. Setting Up Redis Server ==="
systemctl enable redis-server
systemctl restart redis-server

echo "=== 5. Creating systemd Service: FastAPI Backend ==="
cat <<EOF > /etc/systemd/system/alphalens-backend.service
[Unit]
Description=AlphaLens FastAPI Backend Server
After=network.target

[Service]
User=$USER_NAME
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
EnvironmentFile=$PROJECT_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

echo "=== 6. Creating systemd Service: Celery Background Worker ==="
cat <<EOF > /etc/systemd/system/alphalens-worker.service
[Unit]
Description=AlphaLens Celery Worker Service
After=network.target redis-server.service

[Service]
User=$USER_NAME
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/venv/bin/celery -A app.core.celery_app.celery_app worker --loglevel=info --pool=solo
Restart=always
EnvironmentFile=$PROJECT_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

echo "=== 7. Building React Frontend ==="
cd "$PROJECT_DIR/frontend"
# Set backend to point to same domain routes
sudo -u "$USER_NAME" sh -c "echo 'VITE_API_BASE_URL=/' > .env.production"
sudo -u "$USER_NAME" npm install
sudo -u "$USER_NAME" npm run build

echo "=== 8. Configuring Nginx Web Server ==="
# Remove default nginx welcome site
rm -f /etc/nginx/sites-enabled/default

# Create Nginx site configuration
cat <<EOF > /etc/nginx/sites-available/alphalens
server {
    listen 80;
    server_name _; # Change this to your domain name if you have one

    # Serve built React static frontend
    location / {
        root $PROJECT_DIR/frontend/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }

    # Proxy API calls to FastAPI backend
    location ~ ^/(health|worker|llm|top|views|view|universe|synthesize|prefilter|refresh|stocks|pipeline|tasks|analysis|stock) {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable configuration
ln -sf /etc/nginx/sites-available/alphalens /etc/nginx/sites-enabled/alphalens

echo "=== 9. Starting & Enabling Services ==="
systemctl daemon-reload
systemctl start alphalens-backend
systemctl enable alphalens-backend
systemctl start alphalens-worker
systemctl enable alphalens-worker
systemctl restart nginx

echo "=============================================================================="
echo "🎉 Deployment Setup Complete!"
echo "Please make sure to write your environment variables inside: "
echo "   $PROJECT_DIR/.env"
echo "Then restart the services to load the keys:"
echo "   sudo systemctl restart alphalens-backend alphalens-worker"
echo "=============================================================================="
