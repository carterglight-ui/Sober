# Sober Pile

Every sober day drops a bottle on the pile. A phone web app (PWA) that shows the whiskey you didn't drink, plus tools for staying sober.

## Features
- **The pile**: one physics bottle per sober day, labeled with its day number. Tap one to see that day's journal entry; drag to toss, shake button to stir. After 140 bottles, older ones pack into cases of 12.
- **Liquid view**: the same total as liquid filling a pot, bucket, keg, bathtub, oil drum and hot tub.
- **Progress**: streak, money, gallons, standard drinks, calories, hours reclaimed, savings goal, milestone badges, a body-recovery timeline, and progress toward the ~1,095 bottles from the drinking years.
- **Craving mode**: 15-minute countdown with a breathing guide, your "why", your "play the tape forward" note, a good-day journal entry, and one-tap calls to your support person, SAMHSA (1-800-662-4357) or 988.
- **Craving log and patterns**: intensity, triggers and place, with time-of-day and trigger breakdowns.
- **Journal**: daily mood and sleep check-in with a 30-day chart.
- **Letters to future you** that unlock at a pile size, and a **time reclaimed** log.
- **Slips** don't erase the pile; they only restart the streak.
- Works offline. All data stays on the phone in localStorage, with JSON export and import.

## Run locally
Any static server works, for example `python3 -m http.server`, then open http://localhost:8000.

## Deploy
Turn on GitHub Pages (Settings → Pages → Deploy from branch → `main` / root), open the Pages URL on your phone, and use **Add to Home Screen**.

Physics by [Matter.js](https://brm.io/matter-js/) (MIT), vendored in `vendor/`.
