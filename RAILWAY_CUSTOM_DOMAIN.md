# Railway Custom Domain Setup (abminer.cheminformaticlabs.com)

This guide explains how to connect your Namecheap subdomain (`abminer.cheminformaticlabs.com`) to your Railway application under the Cheminformatic Labs portfolio.

## Step 1: Add the Domain in Railway

1.  Log in to your [Railway Dashboard](https://railway.app/dashboard).
2.  Select your **Project** and then your **Service** (e.g., `abminer`).
3.  Go to the **Settings** tab.
4.  Scroll down to the **Domains** section.
5.  Click **Custom Domain**.
6.  Enter `abminer.cheminformaticlabs.com` and click **Add**.
7.  Railway will provide you with a **DNS Target** (usually something like `abminer.up.railway.app` or a specific CNAME target). **Copy this target.**

## Step 2: Configure DNS in Namecheap

1.  Log in to your [Namecheap Account](https://www.namecheap.com/).
2.  Go to **Domain List** and click **Manage** next to `cheminformaticlabs.com` (your root parent domain).
3.  Click on the **Advanced DNS** tab.
4.  Click **Add New Record**:
5.  Configure the subdomain reference:
    *   **Type**: `CNAME Record`
    *   **Host**: `abminer` (for `abminer.cheminformaticlabs.com`)
    *   **Value**: Paste the **DNS Target** from Railway.
    *   **TTL**: `Automatic` (or `1 min`)

## Step 3: Verify and SSL

1.  Go back to the **Railway Settings** page.
2.  Wait for the status to change to **Active** (this can take 5-30 minutes for DNS propagation).
3.  Railway will automatically generate an **SSL Certificate** (HTTPS) for you once the DNS is verified.

---

## Important: Environment Variables

Ensure your Railway service has all the necessary environment variables configured in the **Variables** tab:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `PORT` (should be `3000`)
- `NODE_ENV` (should be `production`)

---

**Note:** As an AI agent, I cannot directly access your Railway or Namecheap accounts. You must perform these steps manually in their respective dashboards.
