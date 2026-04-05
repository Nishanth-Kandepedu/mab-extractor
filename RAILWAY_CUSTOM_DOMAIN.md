# Railway Custom Domain Setup (abminer.bio)

This guide explains how to connect your Namecheap domain (`abminer.bio`) to your Railway application.

## Step 1: Add the Domain in Railway

1.  Log in to your [Railway Dashboard](https://railway.app/dashboard).
2.  Select your **Project** and then your **Service** (e.g., `abminer`).
3.  Go to the **Settings** tab.
4.  Scroll down to the **Domains** section.
5.  Click **Custom Domain**.
6.  Enter `abminer.bio` and click **Add**.
7.  Railway will provide you with a **DNS Target** (usually something like `abminer.up.railway.app` or a specific CNAME target). **Copy this target.**

## Step 2: Configure DNS in Namecheap

1.  Log in to your [Namecheap Account](https://www.namecheap.com/).
2.  Go to **Domain List** and click **Manage** next to `abminer.bio`.
3.  Click on the **Advanced DNS** tab.
4.  Click **Add New Record**:
    *   **Type**: `CNAME Record`
    *   **Host**: `www` (for `www.abminer.bio`)
    *   **Value**: Paste the **DNS Target** from Railway.
    *   **TTL**: `Automatic` (or `1 min`)
5.  To make the root domain (`abminer.bio`) work:
    *   **Type**: `ALIAS Record` (or `ANAME` if available)
    *   **Host**: `@`
    *   **Value**: Paste the **DNS Target** from Railway.
    *   *Note: If Namecheap doesn't support ALIAS for the root, you may need to use a URL Redirect Record from `@` to `https://www.abminer.bio`.*

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
