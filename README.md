# Sober Pile

Every sober day drops a bottle on the pile. A phone web app (PWA) that shows the whiskey you didn't drink, plus tools for staying sober.

## Features
- **Today**: one realistic whiskey bottle per sober day drops onto a stone ledge against a sunlit plaster wall. Bottles use a photo (`assets/bottle.png`) with a compound physics outline (body, shoulders, neck) so they stack the way real bottles do. Tap a bottle to see that day's journal entry; drag to toss. Bottles keep one size: as the pile grows the view follows the top of the pile, and "See the whole pile" (or a pinch) zooms out to show all of it. Past 300 bottles the oldest pack into crates of 12. Money saved, alcohol avoided and the next milestone sit underneath.
- **Liquid view**: the same total as whiskey in a glass jar on the ledge. Tap a container (shot, beer can, milk carton, 2-liter soda, gallon jug, kitchen pot, bucket, gas tank, keg, fish tank, bathtub, oil drum, hot tub, backyard pool, Olympic pool) to see how many of it, or what share of it, you didn't drink.
- **More**: letters to future you, time reclaimed and settings.
- **Progress**: streak, money, gallons, standard drinks, calories, hours reclaimed, savings goal, milestone badges, a body-recovery timeline, and progress toward the ~1,095 bottles from the drinking years.
- **Support**: craving mode, call buttons, your why, and craving patterns.
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
