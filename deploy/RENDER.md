# Put DEScape online (free, Render)

Players only open the link or scan the QR code. They do not need GitHub, VS Code or anything else.
Only you (the person putting it online) need a GitHub account, once.

## Step 1. Make an empty GitHub repository
1. Go to https://github.com/new
2. Repository name: `DEScape`. Leave everything else as it is (Private is fine).
3. Click **Create repository**. Claude uploads the game into it.

## Step 2. Make a free Render account
1. Go to https://render.com and click **Get Started**.
2. Choose **GitHub** to sign up (no email confirmation needed).

## Step 3. Create the site (one click)
1. In Render, click **New +** then **Blueprint**.
2. Connect GitHub if asked, and choose the **DEScape** repository.
3. Click **Apply** (or **Deploy Blueprint**). Render builds the game and its database (5 to 10 minutes).
4. Open the **descape** web service. The link is at the top, like `https://descape.onrender.com`.

## Good to know
- **Sleeping:** on the free plan the site sleeps after 15 minutes with no visitors. The first visit
  after that takes about a minute to wake it up. Open the link a few minutes before you present.
- **Accounts are kept** in a free PostgreSQL database. Render's free database lasts 30 days.
- **Updating the game:** push the new code to the GitHub repository; Render redeploys automatically.
- **Forgot-password emails** are not sent. Students should pick a password they remember.
- Running it locally in VS Code works exactly as before (SQLite, `python manage.py runserver`).
