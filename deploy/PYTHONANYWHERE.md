# Put DEScape online (free, PythonAnywhere)

After this, anyone can open DEScape from a link or a QR code on a phone or laptop.
Nothing to install, and your laptop does not need to stay on. Takes about 15 minutes.

You need: the file **DEScape.zip** downloaded to your computer.

---

## Step 1. Make a free account

1. Go to **https://www.pythonanywhere.com** and click **Pricing & signup**.
2. Click **Create a Beginner account** (the free one).
3. Pick your **username carefully**: it becomes the link.
   Example: username `descape` gives **https://descape.pythonanywhere.com**
4. Fill in email and password, accept the terms, and click **Register**.
   (If they email you a confirmation link, click it.)

## Step 2. Create the web app

1. At the top right, click **Web**.
2. Click **Add a new web app**, then **Next**.
3. Choose **Manual configuration** (NOT "Django").
4. Choose **Python 3.12**, then **Next**.

## Step 3. Upload the zip

1. At the top right, click **Files**.
2. Click the **Upload a file** button and choose **DEScape.zip** from your computer.
   Wait until it appears in the list of files.

## Step 4. Run the setup (two commands)

1. At the top right, click **Consoles**, then click **Bash**. A black terminal opens.
2. Type this and press Enter:

   ```
   unzip -o DEScape.zip
   ```

3. Then type this and press Enter:

   ```
   bash DEScape/deploy/setup_pythonanywhere.sh
   ```

4. Wait about a minute. It should end with **ALL DONE** and show your link.
   If you see **ERROR** instead, take a screenshot and send it to Claude.

## Step 5. Turn it on

1. Click the **☰ menu** (top right of the console page), then **Web**.
2. Scroll to **Security** and switch **Force HTTPS** to **Enabled**.
3. Scroll back to the top and click the big green **Reload** button.
4. Open your link (for example https://descape.pythonanywhere.com). DEScape should appear.
5. Send the link to Claude to get the QR code.

---

## Good to know

- **Accounts:** players create their own account on the site. The online site has its own
  accounts, separate from the ones on your laptop.
- **Forgot password emails** are not sent on the free plan. Students should pick a password they remember.
- **Free plan:** the site stays up for 3 months. To keep it longer, open the **Web** tab and click
  **Run until 3 months from today**.
- **Updating the game later:** upload the new DEScape.zip (Files tab, it replaces the old one),
  run the same two commands in Step 4 again, then click **Reload** on the Web tab.
  Player accounts and progress are kept.
- **Your laptop copy** still works the same way in VS Code (`python manage.py runserver`).
