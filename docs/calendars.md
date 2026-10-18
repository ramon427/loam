# Calendars

Loam's calendar shows several calendars in one view:

- **Google Calendar**, signed in, where you can make, move and change events. Setting it up
  takes about ten minutes; see [Google Calendar](google-calendar.md).
- **Calendars you subscribe to by link**, such as your Outlook or Microsoft 365 work calendar
  (with your Teams meetings), or a Google calendar's secret iCal address. These are read-only:
  you see them, open their details, join their meetings and make meeting notes from them, but
  you change them where they live.

You don't need to sign in to Google to subscribe to a calendar.

## Turn on the calendar

1. Open **Settings › Plugins**, switch off restricted mode if it's on, and turn on
   **Calendar**. Allow what it asks for.
2. Open the calendar with the calendar button at the bottom of the sidebar, or the command
   palette's **Open calendar**.

If you used an earlier version that kept iCal addresses in the plugin's settings, they move into
the calendar's list on their own the first time it opens. If Loam says the plugin's new version
asks for more, select **Review** next to it in **Settings › Plugins** and allow it, so it can
read Outlook's calendars.

## Add your Outlook or Microsoft 365 calendar

Outlook can publish a calendar as a link that other apps read. To get the link, use Outlook on
the web (or the new Outlook for Windows, which has the same settings):

1. Open [Outlook on the web](https://outlook.office.com/calendar) (for a personal account,
   [outlook.live.com](https://outlook.live.com/calendar)) and sign in with your work account.
2. Select **Settings** (the gear at the top right), then **Calendar › Shared calendars**.
3. Under **Publish a calendar**, choose your calendar, then **Can view all details**. With **Can
   view when I'm busy** or **Can view titles and locations**, Loam only gets the times or the
   titles, without descriptions or Teams links.
4. Select **Publish**. Outlook shows two links, HTML and ICS.
5. Copy the **ICS** link. It ends in `.ics`. The HTML link is a web page, which Loam can't read.
6. In Loam's calendar, select **+** next to **Other calendars** (or **Add a calendar by link**),
   paste the link and press Enter.

Loam names the calendar after the feed, or "Work calendar" when Outlook only calls it
"Calendar". You can rename it, pick its color, or switch it off in the same list (the gear next
to **Other calendars**) or with its checkbox in the sidebar.

In the classic Outlook for Windows, **Home › Publish Online › Publish This Calendar** (in the
calendar) leads to the same publishing for a Microsoft 365 or Exchange account. If it isn't
there, use Outlook on the web as above.

Anyone who has the ICS link can see what it shows, so treat it like a password. To stop it,
select **Unpublish** in the same Outlook settings. The link then stops working in Loam too.

### Before you add a work calendar

- **Your organisation may not allow it.** Administrators can turn off publishing, or allow only
  free/busy times. Then **Publish a calendar** is missing or offers less, and there's nothing
  Loam can do about it.
- **Check your organisation's rules.** Copying work calendars into another app may go against
  your company's IT policy, since meeting titles, descriptions and guests leave Microsoft 365.
  Ask first if you're not sure. Loam keeps them on this computer only.
- **Published calendars lag.** Outlook updates the published copy now and then, sometimes hours
  after a change. A meeting that was just made or moved can take a while to show up. To see
  changes at once, look in Outlook.

## Add a Google calendar by link

For a Google calendar you don't want to sign in to, such as one on another account: in Google
Calendar, open **Settings**, choose the calendar, and copy **Secret address in iCal format**.
Add it in Loam the same way as an Outlook link.

## What Loam shows

- Events from all calendars in one day, week, month or agenda view, with each calendar's color.
  When events overlap, they cascade like in Google Calendar; hover over a narrow one for its
  title and time.
- Meetings with a Teams, Google Meet or Zoom link have a **Join** button in their details.
- An event marked private in Outlook shows as "Busy", without its details.
- Events that show you as free look the same as others; their details say "Shows as Free".
- Cancelled meetings (Outlook's "Canceled:" ones) appear struck through. To hide them, set
  **Cancelled meetings** to **Hide** in the plugin's settings.
- Time zones from Outlook (such as "W. Europe Standard Time") are converted to your own.

## Updates and problems

Loam reads each calendar every 15 minutes while the calendar is open, when you come back to
Loam, and when you select the refresh button. It keeps a copy, so the calendar opens with the
last events while offline.

If a calendar can't be read, Loam says why under its name and keeps showing the last copy it
had. The other calendars aren't affected. Common reasons:

- **"Couldn't load Work calendar. The link may be disabled by your organisation, or the
  calendar is no longer published."** Outlook refused the link: it was unpublished, or your
  administrator turned publishing off. Publish it again and replace the link in Loam's list
  (paste the new one into the calendar's ICS link and press Enter).
- **"The link doesn't lead to a calendar."** You copied the HTML link; copy the ICS one.
- **"Couldn't reach …"**: you're offline, or Outlook didn't answer. Loam tries again later.

## Which links Loam can read

Plugins can only reach the hosts their manifest names. The calendar can read published calendars
from:

- `outlook.office365.com`, `outlook.office.com` (Microsoft 365) and `outlook.live.com`
  (Outlook.com)
- `calendar.google.com`

Links to other servers, such as a self-hosted calendar or another calendar service, aren't
supported yet: Loam has no way to let you allow a server of your own choosing for a plugin. Loam
says so when you paste such a link.
