# Hetzner Deployment Guide

This guide explains how to move your application from Railway to a Hetzner Cloud VPS.

## Prerequisites

1.  A **Hetzner Cloud** account.
2.  A **Server (VPS)** created in the Hetzner Console (Ubuntu 22.04 or 24.04 recommended).
3.  **Docker** and **Docker Compose** installed on your server.

## Step 1: Export Your Code

1.  In **AI Studio**, go to the **Settings** menu (top right).
2.  Select **Export to ZIP** or **Export to GitHub**.
3.  If you export to ZIP, download it and extract it on your local machine.

## Step 2: Prepare Your Server

Connect to your Hetzner server via SSH:

```bash
ssh root@your_server_ip
```

Install Docker (if not already installed):

```bash
# Update package list
apt-get update

# Install Docker
apt-get install -y docker.io docker-compose
```

## Step 3: Upload Code to Server

You can use `scp` to upload your files or clone from GitHub:

```bash
# From your local machine (if using ZIP export)
scp -r ./your-app-folder root@your_server_ip:/opt/abminer
```

## Step 4: Configure Environment Variables

Create a `.env` file in the application directory on your server:

```bash
cd /opt/abminer
nano .env
```

Add your API keys:

```env
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GEMINI_API_KEY=your_gemini_key
PORT=3000
NODE_ENV=production
```

## Step 5: Build and Run

Run the following command to start the application:

```bash
docker-compose up -d --build
```

Your application will now be accessible at `http://your_server_ip`.

## Step 6: (Optional) Set up a Domain and SSL

For production use, it's recommended to use a reverse proxy like **Nginx** with **Certbot** for SSL (HTTPS).

1.  Point your domain's A record to your Hetzner server IP.
2.  Install Nginx: `apt-get install -y nginx`
3.  Configure Nginx to proxy traffic to `localhost:3000`.
4.  Install Certbot: `apt-get install -y python3-certbot-nginx`
5.  Run Certbot: `certbot --nginx -d yourdomain.com`

---

**Note:** Since I am an AI agent, I cannot directly access your Hetzner account or perform the migration for you. You will need to follow these steps manually.
