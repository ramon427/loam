# Google Calendar

The Google Calendar plugin shows your calendars in Loam and lets you make, move and change
events. To sign in, it uses an OAuth client that you create in your own Google Cloud project.
It takes about ten minutes, and you only do it once. Loam has no server, so nobody else sees
your sign-in.

If you only want to see a calendar, you can skip all this: paste the calendar's "Secret address
in iCal format" (Google Calendar › Settings › your calendar) into the plugin's settings instead.
That way is read-only.

## 1. Create a Google Cloud project

1. Open the [Google Cloud console](https://console.cloud.google.com/) and sign in with the Google
   account whose calendars you want.
2. Open the project picker at the top, choose **New project**, name it (for example "Loam") and
   select **Create**. Make sure the new project is selected.

## 2. Turn on the Google Calendar API

1. Go to **APIs & Services › Library**.
2. Search for **Google Calendar API**, open it and select **Enable**.

## 3. Set up the consent screen

1. Go to **Google Auth Platform** (in the menu, or search for "Google Auth Platform"). If it asks,
   select **Get started**.
2. **Branding**: enter an app name (for example "Loam") and your email address as the user
   support email.
3. **Audience**: choose **External**. Then, under **Test users**, select **Add users** and add
   your own Google address.
4. Enter your email address as the developer contact and agree to the policy.

You don't need to add scopes under **Data access**. Loam asks for them when you sign in: it can
see and change events in your calendars, and read your list of calendars with their names and
colors. It can't reach your mail, contacts or calendar settings.

## 4. Create a Desktop app client

1. In **Google Auth Platform**, go to **Clients** and select **Create client**.
2. For **Application type**, choose **Desktop app**. Name it and select **Create**.
3. Copy the **Client ID** and the **Client secret**.

## 5. Sign in from Loam

1. In Loam, open **Settings › Plugins**, switch off restricted mode if it's on, and turn on
   **Google Calendar**. Allow what it asks for.
2. Under **Google account**, paste the Client ID, then paste the Client secret and select
   **Save**.
3. Select **Sign in with Google**. Your browser opens Google's sign-in page.
4. Choose your account. While the app is unverified, Google warns "Google hasn't verified this
   app". Since it's your own app, select **Continue** (in some versions, **Advanced** and then
   **Go to Loam**).
5. Allow access to your calendars. When the browser says you're signed in, close the tab.
6. Open the calendar with the calendar button at the bottom of the sidebar, or the command
   palette's **Open calendar**.

The client secret and the sign-in are encrypted with your system's keychain and stay on this
computer. Signing out (in the same settings) revokes Loam's access at Google.

## Staying signed in: Testing or Production

A new app's publishing status is **Testing**. Google ends the sign-in of an app in Testing
after 7 days, because Loam asks for calendar access (more than your name and email). Loam then
says Google signed you out, and you sign in again.

To stay signed in, publish the app: in **Google Auth Platform › Audience**, select **Publish
app** and confirm, so its status is **In production**. You don't need Google's verification to
use it yourself. Google only requires verification for apps with sensitive scopes that you
offer to other people. Until it's verified, your app keeps showing the "Google hasn't verified
this app" warning when you sign in, and at most 100 people can sign in to it.

If you'd rather leave it in Testing, signing in again every week works too.

## Using the calendar

- **Views**: Day (D), 3 days (X), Week (W), Month (M) and Agenda (A). Go to today with T, and
  back and forth with J and K or the arrow keys.
- **Make an event**: drag over the time in the grid, or click a free slot. Give it a title and
  press Enter, or choose **More options** for everything else. Press C for a new event in the
  full editor.
- **Change an event**: drag it to move it (to another day too), or drag its bottom edge to change
  its length. Double-click it, or select it and press Enter, to open the editor. For a recurring
  event, Loam asks whether the change is for this event, this and the following events, or all
  of them.
- **Delete** with Delete or Backspace. Ctrl+Z (Cmd+Z on a Mac), or **Undo** on the message that
  appears, undoes the last move, resize, edit, new event or deletion.
- **Meeting notes**: open an event and choose **Create meeting note** for a note with the
  event's time, guests, Meet link and description.
- **Today's agenda**: type `/agenda` in a note.

The plugin's settings set the first day of the week, your working hours, the default length and
notification of new events, and whether to show events you declined.
